import { extractLinkPreview, parsePublicPreviewUrl } from "../../shared/link-preview";
import type { Hono } from "hono";
import type { GenericId, Infer } from "convex/values";
import { laneOf, type attachmentDoc, type conversationDoc, type draftView, type messageDoc, type scheduledDoc, type CommaOutboxLane, type CommaOutboxPayload, type CommaReaction, type CommaReactionState, type CommandResult } from "../../../../convex/schema/comma/validators";
import { handleKey, imessage, routeFor } from "../../../../convex/comma/conversationIdentity";
import { resolveConversationNames } from "../../../../convex/comma/names";
import { formatAddress } from "../../shared/address";
import { fixtureChatGuid, fixtureConversationId } from "../../shared/fixture-ids";
import { profileRoute, unsupportedReason } from "../../../../convex/comma/routeSupport";
import { messageService } from "../../shared/platform-profile";
import { NOT_SENT_AFTER_MS, NOT_SENT_ERROR, pendingGuid } from "../../shared/pending-send";
import { fromTapback, messageKey, reactionWrites, shownReactions } from "../../../../convex/comma/reactions";
import { attachmentRead, messageRead } from "../../../../convex/comma/messageShape";
import type { FixtureRouteControls } from "../../server/app";
import { buildThread, isGenuineUnreadInbound, mapChat, mapMessage, type UnreadSummary } from "../../server/map";
import { toConversationInputs, toMessageRow } from "../../server/bridge/mapper";
import { BRIDGE_HEARTBEAT_MS } from "../../server/bridge/state";
import { mapScheduledMessage } from "../../server/scheduled";
import { ScheduledSendNow } from "../../server/scheduled-send-now";
import { ChatCommands } from "../../server/commands";
import { WhisperService } from "../../server/whisper";
import type { ConversationId } from "../../server/ai/service";
import type { OverlayDb } from "../../server/db";
import type { BridgeMessage, ChatSummary, Contact, ReplySuggestions, TranscriptState } from "../../shared/types";
import type { BBMessage } from "../../server/bb-types";
import { createAgentFixture } from "./agent";
import { createTodayFixture, type TodayMode } from "./today";
import { createTriageFixture } from "./triage";
import type { FixtureBlueBubbles } from "./fake-bluebubbles";
import { AGENT_SEED, fixtureSeed, FIXTURE_NOW, type FixtureIdentity } from "./world";

type Conversation = Infer<typeof conversationDoc> & Pick<ChatSummary, "flags" | "unreadCount"> & { groupPhotoUrl: string | null };
type ConvexMessage = Omit<Infer<typeof messageDoc>, "reactions"> & { reactions: CommaReaction[] }
  & { attachments: Array<Infer<typeof attachmentDoc> & { thumbUrl: string | null; originalUrl: string | null }> };
type Pagination = { numItems: number; cursor: string | null };

function id<Table extends string>(value: string): GenericId<Table> {
  return value as GenericId<Table>;
}

export function conversationRow(chat: ChatSummary): Conversation {
  return {
    _id: id(chat.guid), _creationTime: FIXTURE_NOW,
    platform: imessage.platform, conversationKey: imessage.conversationKey({ isGroup: chat.isGroup, primaryChatGuid: chat.guid, participants: chat.participants }),
    primaryChatGuid: chat.guid, chatGuids: [chat.guid],
    displayName: chat.displayName, isGroup: chat.isGroup, participants: chat.participants,
    ...(chat.lastMessage ? { lastMessage: chat.lastMessage } : {}),
    lastMessageAt: chat.lastMessage?.dateCreated ?? 0, isSpam: chat.isSpam,
    hasGroupPhoto: chat.hasGroupPhoto ?? false, groupPhotoUrl: chat.groupPhotoUrl ?? null, updatedAt: FIXTURE_NOW,
    flags: chat.flags, unreadCount: chat.unreadCount,
    ...(chat.crm ? { crm: chat.crm } : {}),
  };
}

/**
 * Reactions as production Convex serves them: every tapback goes through the bridge mapper and ingest's
 * reaction rules, in arrival order since the fixture clock is pinned.
 */
function reactionsByGuid(raw: BBMessage[], chatGuid: string, names: FixtureIdentity): (guid: string) => CommaReaction[] {
  const tapbacks = raw.filter((m) => m.associatedMessageGuid && m.associatedMessageType);
  let states: CommaReactionState[] = [];
  for (const m of [...tapbacks].sort((a, b) => (a.dateCreated ?? 0) - (b.dateCreated ?? 0))) {
    const row = toMessageRow(m, id(chatGuid), 0);
    const event = fromTapback({ ...row, platform: "imessage", tapback: row.imessage.tapback });
    if (!event) continue;
    for (const { row, state } of reactionWrites(states.filter((s) => s.targetKey === event.targetKey), event)) {
      states = row ? states.map((s) => (s === row ? state : s)) : [...states, state];
    }
  }
  return (guid) => shownReactions(states.filter((state) => state.targetKey === messageKey("imessage", guid)))
    .map((r) => ({ ...r, senderName: r.senderAddress ? names.lookup(r.senderAddress) : null }));
}

/** A row as production's read serves it: iMessage's fields under `imessage`, and flat for older clients. */
function served(row: ConvexMessage): ConvexMessage {
  return { ...messageRead(row), attachments: row.attachments.map(attachmentRead) };
}

export function messageRow(message: BridgeMessage, clientKey?: string): ConvexMessage {
  const conversationId = id<"comma_conversations">(message.chatGuid);
  return served({
    _id: id(message.guid), _creationTime: message.dateCreated,
    guid: message.guid, conversationId, chatGuid: message.chatGuid,
    dateCreated: message.dateCreated,
    ...(message.dateRead !== null ? { dateRead: message.dateRead } : {}),
    ...(message.dateDelivered !== null ? { dateDelivered: message.dateDelivered } : {}),
    isFromMe: message.isFromMe, text: message.text, service: message.service,
    ...(message.sender ? { sender: message.sender } : {}),
    error: message.error, edited: message.edited, retracted: message.retracted,
    isTapback: message.isAssociatedMessage ?? false, reactions: message.reactions,
    ...(message.replyToGuid ? { replyToGuid: message.replyToGuid } : {}),
    ...(message.replyToPreview ? { replyToPreview: message.replyToPreview } : {}),
    ...(message.replyToFromMe !== null ? { replyToFromMe: message.replyToFromMe } : {}),
    isGroupEvent: message.isGroupEvent,
    ...(message.isSpam !== undefined ? { isSpam: message.isSpam } : {}),
    ...(message.special ? { special: message.special } : {}),
    ...(message.sendEffect ? { sendEffect: message.sendEffect } : {}),
    mentions: message.mentions ?? [], attachmentGuids: message.attachments.map((a) => a.guid),
    ...(clientKey ? { clientKey } : {}), sourceVersion: 1,
    attachments: message.attachments.map((a) => ({
      _id: id(a.guid), _creationTime: message.dateCreated,
      guid: a.guid, messageGuid: message.guid, conversationId,
      ...(a.mimeType ? { mimeType: a.mimeType } : {}),
      ...(a.filename ? { filename: a.filename, transferName: a.filename } : {}),
      ...(a.width !== null ? { width: a.width } : {}),
      ...(a.height !== null ? { height: a.height } : {}),
      ...(a.totalBytes !== null ? { totalBytes: a.totalBytes } : {}),
      isSticker: false, hideAttachment: false, isOnDisk: true,
      thumbUrl: a.mimeType?.startsWith("image/") ? `/__fixture/media/${encodeURIComponent(a.guid)}` : null,
      originalUrl: `/__fixture/media/${encodeURIComponent(a.guid)}`, sourceVersion: 1,
    })),
  });
}

/** Gives every conversation in a result the id the client sees; the fixture's own rows use the chat GUID. */
function withConversationIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withConversationIds);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = Object.fromEntries(Object.entries(value).map(([key, field]) =>
    [key, key === "conversationId" && typeof field === "string" ? fixtureConversationId(field)
      : key === "openAtSnapshot" && Array.isArray(field) ? field.map((guid) => fixtureConversationId(String(guid)))
      : withConversationIds(field)]));
  if (typeof out.primaryChatGuid === "string" && typeof out._id === "string") out._id = fixtureConversationId(out._id);
  return out;
}

export function paginate<T>(rows: readonly T[], options: Pagination) {
  const start = options.cursor === null ? 0 : Number(options.cursor);
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(options.numItems) || options.numItems < 1) {
    throw new FixtureError("Invalid pagination options", 400);
  }
  const end = start + options.numItems;
  return { page: rows.slice(start, end), isDone: end >= rows.length, continueCursor: String(Math.min(end, rows.length)) };
}

class FixtureError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export async function fixtureMessageWindow(bb: FixtureBlueBubbles, names: FixtureIdentity, args: Record<string, unknown>) {
  const bounds = [args.before, args.after, args.around].filter((value) => value !== undefined);
  if (bounds.length !== 1 || typeof bounds[0] !== "number" || !Number.isFinite(bounds[0])) {
    throw new FixtureError("Exactly one numeric before, after, or around must be provided", 400);
  }
  const chatGuid = String(args.conversationId);
  const result = await bb.chatMessages(chatGuid, { limit: Number.MAX_SAFE_INTEGER });
  if (!result.ok) throw new FixtureError(result.error);
  const reactions = reactionsByGuid(result.value, chatGuid, names);
  const rows = buildThread(result.value, chatGuid, names).map((message) => ({ ...message, reactions: reactions(message.guid) }));
  const bound = bounds[0];
  const window = args.around !== undefined
    ? [...rows.filter((row) => row.dateCreated <= bound).slice(-40), ...rows.filter((row) => row.dateCreated > bound).slice(0, 40)]
    : args.before !== undefined ? rows.filter((row) => row.dateCreated < bound).slice(-40)
      : rows.filter((row) => row.dateCreated > bound).slice(0, 40);
  return window.map((message) => messageRow(message, bb.clientKeyFor(message.guid)));
}

export function registerConvexFixture(app: Hono, controls: FixtureRouteControls, bb: FixtureBlueBubbles, db: OverlayDb, names: FixtureIdentity, additionalHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {}) {
  const drafts = new Map<string, Infer<typeof draftView>>();
  const receipts = new Map<string, { id: string; status: "pending" | "sent" | "failed"; clientKey: string; updatedAt: number; error?: string; result?: CommandResult; resultGuid?: string }>();
  /** Each send's conversation and payload, for a retry. */
  const sendPayloads = new Map<string, { chatGuid: string; payload: CommaOutboxPayload }>();
  /**
   * The Mini as the outbox sees it. While it is away a send stays queued, cancellable, until it comes back or the
   * Not sent deadline passes, as production's outbox holds it.
   */
  const mini = { online: true, heartbeat: true, beatAt: new Date().getTime(), notSentAfterMs: NOT_SENT_AFTER_MS, held: new Map<string, { release: () => void; timer: ReturnType<typeof setTimeout> }>() };
  const strand = (clientKey: string, error: string) => {
    const receipt = receipts.get(clientKey);
    if (receipt) receipts.set(clientKey, { ...receipt, status: "failed", error, updatedAt: Date.now() });
    const temp = temps.get(clientKey);
    if (temp) temps.set(clientKey, { ...temp, error: 1, dateCreated: Date.now(), sendState: error === NOT_SENT_ERROR ? "notSent" : "failed" });
  };
  const releaseHeld = () => {
    for (const [clientKey, { release, timer }] of [...mini.held]) {
      clearTimeout(timer);
      mini.held.delete(clientKey);
      release();
    }
  };
  const shelves = new Map<string, ReplySuggestions>();
  const deletedChats = new Set<string>();
  const uploads = new Map<string, { bytes: Blob; filename?: string; mimeType?: string }>();
  const transcripts = new Map<string, TranscriptState>();
  const inFlight = new Map<string, Promise<string>>();
  const temps = new Map<string, ConvexMessage>();
  const turns = new Map<CommaOutboxLane, Promise<unknown>>();
  // Drives slow one Convex function, or one command kind as `outbox:<kind>`, to watch the client across a long round trip.
  const latency = new Map<string, number>();
  const wait = async (name: string) => {
    const delay = latency.get(name);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  };
  const peerTyping = new Map<string, { peerTyping: boolean; updatedAt: number; expiresAt: number }>();
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  bb.onEvent((event) => {
    if (event.kind === "typing") {
      const now = new Date().getTime();
      peerTyping.set(event.chatGuid, { peerTyping: event.display, updatedAt: now, expiresAt: now + (event.display ? 12_000 : 0) });
    } else if (event.kind === "stream-connected") peerTyping.clear();
  });
  const commands = new ChatCommands(bb, names);
  const ai = controls.ai;
  const health = () => controls.health();
  const miniAi = () => ({ suggestions: ai.available, reactionSuggestions: bb.hasPrivateApi });
  // The fake runner beats on the wall clock the browser judges it by, not the pinned Date.now.
  const aiStatus = () => ({ ...miniAi(), agentHeartbeatAt: new Date().getTime() });
  const agent = createAgentFixture({
    userText: (conversationId) => {
      const draft = drafts.get(conversationId);
      return draft && draft.source !== "agent" ? draft.text : "";
    },
    writeAgentDraft: (conversationId, text, note, chatId) => {
      drafts.set(conversationId, { _id: id(`draft-${conversationId}`), _creationTime: FIXTURE_NOW, conversationId: id(conversationId),
        text, note, updatedAt: Date.now(), source: "agent", agentChatId: id(chatId) });
    },
    upload: (storageId) => {
      const upload = uploads.get(storageId);
      return upload?.filename && upload.mimeType ? { filename: upload.filename, mimeType: upload.mimeType, size: upload.bytes.size } : null;
    },
    // Production's read, from the world: what this DM's person sent in every other conversation, newest first.
    personContext: async (conversationId) => {
      const rows = await conversations();
      const here = rows.find((row) => row._id === conversationId);
      if (!here || here.isGroup) return null;
      const address = here.participants[0]?.address;
      const byGuid = new Map(rows.flatMap((row) => row.chatGuids.map((guid) => [guid, row] as const)));
      const listed = await bb.queryMessages({ limit: Number.MAX_SAFE_INTEGER, offset: 0 });
      const lines = (listed.ok ? listed.value : []).flatMap((message) => {
        const row = byGuid.get(message.chats?.[0]?.guid ?? "");
        if (!row || row._id === here._id || message.isFromMe || message.handle?.address !== address || !message.text) return [];
        return [{ at: message.dateCreated ?? 0, conversationId: row._id, conversation: row.displayName, kind: row.isGroup ? "group" as const : "dm" as const,
          platform: "imessage" as const, fromMe: false, sender: here.displayName, text: message.text }];
      }).sort((a, b) => b.at - a.at);
      return { name: here.displayName, lines: lines.slice(0, 10), more: lines.length > 10 };
    },
  }, 400, AGENT_SEED);
  const triage = createTriageFixture({
    lastMessage: async (chatGuid) => {
      const row = (await conversations()).find((candidate) => candidate._id === chatGuid);
      return row ? row.lastMessage ?? null : undefined;
    },
    settled: (chatGuid) => agent.outbox.settle(chatGuid),
    unsettled: (chatGuid) => agent.outbox.unsettle(chatGuid),
  });
  // The bridge's own grouping merges service siblings; the primary row speaks for the conversation.
  const chatSummaries = async () => {
    const listed = await bb.queryChats(Number.MAX_SAFE_INTEGER);
    const unreadInbound = await bb.queryMessages({ limit: Number.MAX_SAFE_INTEGER, offset: 0, unreadInboundOnly: true });
    if (!listed.ok) throw new FixtureError(listed.error, 502);
    const unread = new Map<string, UnreadSummary>();
    for (const message of unreadInbound.ok ? unreadInbound.value : []) {
      const chatGuid = message.chats?.[0]?.guid;
      if (!chatGuid || !isGenuineUnreadInbound(message)) continue;
      const current = unread.get(chatGuid);
      unread.set(chatGuid, { count: (current?.count ?? 0) + 1,
        firstUnreadAt: Math.min(current?.firstUnreadAt ?? message.dateCreated!, message.dateCreated!) });
    }
    const raw = new Map(listed.value.map((chat) => [chat.guid, chat]));
    return toConversationInputs(listed.value.filter((chat) => chat.lastMessage)).map((row) => {
      const [primary, ...siblings] = row.chats.map(({ chatGuid }) => mapChat(raw.get(chatGuid)!, names, unread.get(chatGuid)));
      // Replying reads the whole conversation, so older sibling unreads only count while the newest message is theirs.
      const counted = primary.lastMessage?.isFromMe ? [] : siblings;
      const firstUnread = [primary, ...counted].flatMap((chat) => chat.firstUnreadAt ?? []);
      return { ...triage.flagged({ ...primary,
        unreadCount: counted.reduce((sum, chat) => sum + chat.unreadCount, primary.unreadCount),
        firstUnreadAt: firstUnread.length ? Math.min(...firstUnread) : null,
        known: [primary, ...siblings].some((chat) => chat.known) }), chatGuids: row.chats.map((chat) => chat.chatGuid) };
    });
  };
  const siblingsOf = async (chatGuid: string) => (await chatSummaries()).find((chat) => chat.chatGuids.includes(chatGuid))?.chatGuids ?? [chatGuid];
  const accept = (result: { ok: boolean; error?: string; status?: number }) => {
    if (!result.ok) throw new FixtureError(result.error ?? "BlueBubbles operation failed", result.status);
  };
  const conversations = async () => Promise.all((await chatSummaries()).filter((chat) => !deletedChats.has(chat.guid)).map(async (chat) => {
    const raw = await bb.getChat(chat.guid);
    const row = conversationRow(chat);
    // Production's preview is the newest send the bridge has not finished.
    const queued = [...temps.values()].filter((temp) => temp.conversationId === chat.guid).at(-1);
    const preview = queued ? {
      lastMessage: { guid: queued.guid, text: queued.text, dateCreated: queued.dateCreated, isFromMe: true, senderName: null, hasAttachments: false },
      lastMessageAt: Math.max(row.lastMessageAt, queued.dateCreated),
    } : {};
    const rawDisplayName = raw.ok ? raw.value.displayName ?? "" : "";
    // Names resolve here, the way comma/queries resolves them, so an identity rename shows on the next read.
    const resolved = resolveConversationNames({ ...row, rawDisplayName }, row.participants.map((p) => names.person(p.address)));
    const sender = row.isGroup ? (raw.ok ? raw.value.lastMessage?.handle?.address : undefined) : row.participants[0]?.address;
    const lastMessage = row.lastMessage && !row.lastMessage.isFromMe && sender
      ? { lastMessage: { ...row.lastMessage, senderName: names.lookup(sender) ?? formatAddress(sender) } } : {};
    return { ...row, ...lastMessage, ...preview, chatGuids: chat.chatGuids, rawDisplayName,
      displayName: resolved.displayName, participants: resolved.participants, known: resolved.known, contactsAvailable: names.available,
      searchNames: resolved.searchNames };
  }));
  const searchContacts = (query: string, limit = 25): Contact[] => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const digits = /^[+\d\s().-]+$/.test(needle) ? needle.replace(/\D/g, "") : "";
    const contacts = new Map<string, Contact>();
    for (const person of fixtureSeed().contacts ?? []) {
      const addresses = [...(person.phoneNumbers ?? []), ...(person.emails ?? [])].map((entry) => entry.address);
      const terms = [person.displayName, person.firstName, person.lastName, person.nickname,
        [person.firstName, person.lastName].filter(Boolean).join(" ")];
      if (!terms.some((term) => term?.toLowerCase().includes(needle)) && !addresses.some((address) =>
        address.toLowerCase().includes(needle) || (digits && !address.includes("@") && address.replace(/\D/g, "").includes(digits)))) continue;
      for (const address of addresses) contacts.set(address.toLowerCase(), {
        address: address.toLowerCase(), name: names.lookup(address) ?? person.displayName ?? address,
        is_favorite: names.personCrm(address)?.is_favorite,
      });
    }
    return [...contacts.values()].slice(0, Math.max(0, Math.min(25, Math.floor(limit))));
  };
  const messages = async (chatGuid: string): Promise<ConvexMessage[]> => {
    if (deletedChats.has(chatGuid)) return [];
    const pages = await Promise.all((await siblingsOf(chatGuid)).map((guid) =>
      bb.chatMessages(guid, { limit: Number.MAX_SAFE_INTEGER, sort: "DESC" })));
    if (pages.every((page) => !page.ok)) throw new FixtureError("fetch failed", 502);
    const raw = new Map(pages.flatMap((page) => page.ok ? page.value.map((message) => [message.guid, message] as const) : []));
    const reactions = reactionsByGuid([...raw.values()], chatGuid, names);
    return [...buildThread([...raw.values()], chatGuid, names)
      .map((message) => messageRow({ ...message, reactions: reactions(message.guid) }, bb.clientKeyFor(message.guid))),
      ...[...temps.values()].filter((temp) => temp.conversationId === chatGuid).map(served)].sort((a, b) => b.dateCreated - a.dateCreated);
  };
  const execute = async (chatGuid: string, payload: CommaOutboxPayload, clientKey: string): Promise<CommandResult | undefined> => {
    switch (payload.kind) {
      case "send": {
        const result = await commands.send(chatGuid, payload, clientKey);
        accept(result);
        if (result.ok) return { kind: "send" as const, message: { ...result.value, mentions: result.value.mentions ?? [] } };
        break;
      }
      case "sendAttachment": {
        const upload = uploads.get(payload.storageId);
        if (!upload?.filename || upload.filename !== payload.filename || upload.mimeType !== payload.mimeType) throw new FixtureError("Finalized upload not found", 400);
        const bytes = new Uint8Array(await upload.bytes.arrayBuffer());
        let result = payload.isAudioMessage ? await bb.sendAudio(chatGuid, payload.filename, bytes) : await bb.sendAttachmentWithCaption(chatGuid, payload.filename, bytes, payload.caption);
        if (!result.ok && result.error === "not implemented in fake") {
          result = await bb.sendText(chatGuid, payload.isAudioMessage ? "" : payload.caption ?? "");
          if (result.ok) result.value.attachments = [{ guid: payload.storageId, mimeType: payload.mimeType, transferName: payload.filename, totalBytes: bytes.byteLength, transferState: 5 }];
        }
        accept(result);
        if (result.ok) {
          if (payload.isAudioMessage && payload.caption) accept(await bb.sendText(chatGuid, payload.caption));
          return { kind: "sendAttachment" as const, message: mapMessage(result.value, chatGuid, names) };
        }
        break;
      }
      case "transcribe": {
        transcripts.set(payload.attachmentGuid, { state: "working" });
        const transcript = await WhisperService.forCache(db)!.transcribe(payload.attachmentGuid);
        transcripts.set(payload.attachmentGuid, transcript);
        return { kind: "transcribe" as const, transcript };
      }
      // Production's enqueue applies the triage kinds in Convex; only markRead goes on to the Mini, for the receipt.
      case "markRead":
        triage.read(chatGuid, FIXTURE_NOW);
        accept({ ok: await commands.markRead(await siblingsOf(chatGuid)), error: "BlueBubbles mark read failed" });
        break;
      case "markUnread": await triage.flag(chatGuid, { markedUnread: true }); break;
      case "pin": await triage.flag(chatGuid, { pinned: payload.value }); break;
      case "mute": await triage.flag(chatGuid, { mutedUnresponded: payload.value }); break;
      case "settle": await triage.settle(chatGuid, payload.messageGuid); break;
      case "unsettle": await triage.unsettle(chatGuid); break;
      case "react": accept(await commands.react(payload.messageGuid, { ...payload, chatGuid, siblings: await siblingsOf(chatGuid) })); break;
      case "edit": accept(await commands.edit(payload.messageGuid, payload.text, payload.partIndex)); break;
      case "unsend": accept(await commands.unsend(payload.messageGuid, payload.partIndex)); break;
      case "delete": accept(await commands.delete(payload.messageGuid, await siblingsOf(chatGuid))); break;
      case "rename": accept(await commands.rename(chatGuid, payload.name)); break;
      // Production answers with the stored row, which the composer waits for before it clears.
      case "schedule":
      case "editScheduled": {
        const result = await commands.schedule({ ...payload, chatGuid }, payload.kind === "editScheduled" ? payload.bbId : undefined);
        accept(result);
        if (!result.ok) break;
        const name = (await chatSummaries()).find((chat) => chat.chatGuids.includes(result.value.payload.chatGuid))?.displayName;
        return { kind: payload.kind, scheduled: mapScheduledMessage(result.value, name ?? result.value.payload.chatGuid) };
      }
      case "typing": {
        if (payload.active && payload.expiresAt <= new Date().getTime()) return { kind: "typing" as const, ok: true as const };
        const timer = typingTimers.get(chatGuid);
        if (timer) clearTimeout(timer);
        typingTimers.delete(chatGuid);
        accept(await bb.setTyping(chatGuid, payload.active));
        if (payload.active) {
          const expiry = setTimeout(() => { typingTimers.delete(chatGuid); void bb.setTyping(chatGuid, false); }, Math.max(0, payload.expiresAt - new Date().getTime()));
          expiry.unref(); typingTimers.set(chatGuid, expiry);
        }
        return { kind: "typing" as const, ok: true as const };
      }
      case "cancelScheduled": accept(await commands.cancelScheduled(payload.bbId)); break;
      case "sendScheduledNow": accept(await new ScheduledSendNow(bb).send(payload.bbId)); break;
      case "suggestions": {
        const result = await ai.replySuggestions(chatGuid as ConversationId, payload.refresh, payload.model);
        if (!result.ok) throw new FixtureError(result.error, 502);
        const generated = result.value;
        const anchor = (await conversations()).find((row) => row.primaryChatGuid === chatGuid)?.lastMessage;
        const suggestions = { ...generated, basedOnMessageGuid: anchor?.guid ?? generated.basedOnMessageGuid,
          suggestions: generated.suggestions.map((suggestion) => suggestion.kind === "reaction" && anchor
            ? { ...suggestion, targetMessageGuid: anchor.guid, targetMessagePreview: anchor.text } : suggestion),
          event: generated.event ?? null };
        if (!suggestions.stale) shelves.set(JSON.stringify([chatGuid, payload.model]), suggestions);
        return { kind: "suggestions" as const, suggestions };
      }
      case "suggestionFeedback": {
        if (payload.feedback.suggestion.kind === "reaction") ai.recordReactionFeedback(chatGuid as ConversationId, payload.feedback);
        else {
          const result = ai.recordSuggestionFeedback(chatGuid as ConversationId, payload.feedback);
          if (!result.ok) throw new FixtureError(result.error, 400);
        }
        return { kind: "suggestionFeedback" as const, ok: true as const };
      }
      case "clearSuggestionLearning":
        ai.clearSuggestionLearning();
        shelves.clear();
        return { kind: "clearSuggestionLearning" as const, ok: true as const };
      case "identify": {
        const result = await ai.identify(chatGuid as ConversationId);
        if (!result.ok) throw new FixtureError(result.error, 502);
        return { kind: "identify" as const, contact: result.value };
      }
      case "createChat": {
        const result = await commands.createChat(payload);
        accept(result);
        if (result.ok) return { kind: "createChat", chatGuid: result.value.chat.guid, service: "iMessage",
          isGroup: payload.addresses.length > 1, participants: (result.value.chat.participants ?? []).map((p) => p.address), message: result.value.message };
        break;
      }
      case "sendContact": {
        if (!payload.name || !payload.address) throw new FixtureError("name and address required", 400);
        const result = await bb.sendText(chatGuid, payload.caption?.trim() || "\ufffc", undefined, undefined, clientKey);
        accept(result);
        if (result.ok) {
          result.value.attachments = [{ guid: `card-${result.value.guid}`, mimeType: "text/vcard",
            transferName: `${payload.name}.vcf`, totalBytes: 100, transferState: 5 }];
          return { kind: "sendContact", message: mapMessage(result.value, chatGuid, names) };
        }
        break;
      }
      case "participant": accept(await commands.participant(chatGuid, payload.address, payload.action)); break;
      case "leaveGroup": accept(await commands.leaveGroup(chatGuid)); break;
      case "deleteChat":
        if (payload.chatGuid !== chatGuid) throw new FixtureError("Chat alias is not in this conversation", 400);
        accept(await commands.deleteChat(payload.chatGuid));
        db.deleteSuggestionLearningFor([payload.chatGuid]);
        deletedChats.add(payload.chatGuid);
        break;
      case "createFaceTimeLink": {
        const result = await commands.createFaceTimeLink(chatGuid);
        accept(result);
        if (result.ok) return { kind: "createFaceTimeLink", message: result.value };
        break;
      }
      default: throw new FixtureError(`Unknown fixture outbox command: ${JSON.stringify(payload)}`, 400);
    }
    if (["react", "edit", "unsend", "delete", "markRead", "markUnread", "pin", "mute", "settle", "unsettle", "rename", "participant", "leaveGroup", "deleteChat", "cancelScheduled", "sendScheduledNow"].includes(payload.kind)) {
      return { kind: payload.kind, ok: true } as CommandResult;
    }
    return undefined;
  };
  const attachment = async (guid: string) => {
    for (const chat of await conversations()) {
      for (const message of await messages(chat.primaryChatGuid)) {
        const found = message.attachments.find((a) => a.guid === guid);
        if (found) return found;
      }
    }
    return null;
  };
  app.post("/__fixture/upload", async (c) => {
    // Read the body before naming the upload, so two uploads in flight never share an id.
    const bytes = new Blob([await c.req.arrayBuffer()], { type: c.req.header("Content-Type")?.split(";")[0].trim() });
    const storageId = `fixture-storage-${uploads.size + 1}`;
    uploads.set(storageId, { bytes });
    return c.json({ storageId });
  });
  app.get("/__fixture/media/:guid", (c) => {
    const upload = uploads.get(c.req.param("guid"));
    return upload ? new Response(upload.bytes) : bb.downloadAttachment(c.req.param("guid"));
  });
  const today = createTodayFixture({
    chats: chatSummaries,
    clears: triage.clears,
    canonical: async (chatGuid) => (await siblingsOf(chatGuid))[0]!,
  });
  // Drives switch the header between the seeded queue, before the morning build, and a failed build.
  app.post("/__fixture/today", async (c) => {
    const { mode } = await c.req.json<{ mode: TodayMode }>();
    if (mode !== "seeded" && mode !== "unbuilt" && mode !== "failed") return c.json({ error: "mode must be seeded, unbuilt or failed" }, 400);
    today.setMode(mode);
    return c.json({ ok: true });
  });
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    ...today.handlers,
    ...triage.handlers,
    "comma/triage:markRead": async (args) => {
      triage.read(String(args.conversationId), Number(args.at));
      return handlers["comma/outbox:enqueue"]!({ clientKey: `markRead-${String(args.conversationId)}-${new Date().getTime()}`, conversationId: args.conversationId, payload: { kind: "markRead" } });
    },
    "comma/linkPreview:fetchLinkPreview": async (args) => {
      const url = typeof args.url === "string" ? parsePublicPreviewUrl(args.url) : null;
      return url ? extractLinkPreview('<title>Fixture link preview</title><meta name="description" content="A deterministic preview for fixture messages.">', url) : null;
    },
    ...agent.handlers,
    ...additionalHandlers,
    "identity/mutations:renamePerson": async (args) => names.rename(args as Parameters<FixtureIdentity["rename"]>[0]),
    "identity/queries:searchContacts": async (args) => searchContacts(String(args.q), args.limit === undefined ? 25 : Number(args.limit)),
    "comma/conversationInfo:findChat": async (args) => {
      const key = handleKey(String(args.address));
      const row = (await conversations()).find((row) => !row.isGroup && row.participants.length === 1 && row.conversationKey === key);
      const guid = row && routeFor(row, args.service === "iMessage" || args.service === "SMS" ? args.service : undefined)?.chatGuid;
      return row && guid ? { conversationId: row._id, chatGuid: guid, service: imessage.sendService(guid), isGroup: false, participants: row.participants.map((p) => p.address) } : null;
    },
    "comma/conversationInfo:chatInfo": async (args) => {
      const row = (await conversations()).find((row) => row._id === args.conversationId);
      return row ? { guid: row.primaryChatGuid, displayName: row.rawDisplayName || null, isGroup: row.isGroup,
        participants: row.participants.map((p) => ({ address: p.address, name: names.lookup(p.address) ?? p.name ?? p.address, is_favorite: names.personCrm(p.address)?.is_favorite })) } : null;
    },
    "comma/presence:presence": async (args) => {
      const row = (await siblingsOf(String(args.conversationId))).map((guid) => peerTyping.get(guid))
        .filter((typing) => typing !== undefined).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      return row ? { ...row, peerTyping: row.peerTyping && row.expiresAt > new Date().getTime() } : null;
    },
    "comma/bridgeState:bridgeState": async () => {
      // On the wall clock the browser judges it by, once a minute like the bridge, so a poll is not a new state.
      // A Mini that is away last beat ten minutes ago.
      const now = new Date().getTime();
      if (mini.heartbeat && now - mini.beatAt >= BRIDGE_HEARTBEAT_MS) mini.beatAt = now;
      const lastSeenAt = mini.beatAt - (mini.heartbeat ? 0 : 10 * 60_000);
      return { key: "mini", ...health(), ...miniAi(), whisperAvailable: false, whisperDetail: "Fixture transcription unavailable", lastSeenAt };
    },
    "comma/uploads:generateAttachmentUploadUrl": async () => "/__fixture/upload",
    "comma/uploads:finalizeUpload": async (args) => {
      const upload = uploads.get(String(args.storageId));
      if (!upload) throw new FixtureError("Uploaded file not found", 400);
      if (!args.filename || upload.bytes.type.split(";")[0] !== args.mimeType || !upload.bytes.size) throw new FixtureError(`Invalid upload metadata: ${upload.bytes.type}, ${upload.bytes.size} bytes`, 400);
      upload.filename = String(args.filename); upload.mimeType = String(args.mimeType);
      return `upload-${String(args.storageId)}`;
    },
    "comma/media:attachmentMedia": async (args) => {
      const found = await attachment(String(args.guid));
      return found ? { guid: found.guid, thumbUrl: found.thumbUrl, originalUrl: found.originalUrl } : null;
    },
    "comma/media:attachmentChatGuid": async (args) => (await attachment(String(args.guid)))?.conversationId ?? null,
    "comma/media:transcriptState": async (args) => transcripts.get(String(args.attachmentGuid)) ?? WhisperService.forCache(db)!.state(String(args.attachmentGuid)),
    "comma/media:gallery": async (args) => {
      const cap = Math.max(0, Math.min(120, Math.floor(Number(args.limit ?? 120))));
      const seen = new Set<string>();
      return (await messages(String(args.conversationId))).flatMap((message) => message.attachments.flatMap((a) => {
        const isImage = a.mimeType?.startsWith("image/") ?? false;
        const isVideo = a.mimeType?.startsWith("video/") ?? false;
        if ((!isImage && !isVideo) || seen.has(a.guid) || a.hideAttachment || message.retracted || message.isTapback) return [];
        seen.add(a.guid);
        return [{ guid: a.guid, mimeType: a.mimeType ?? null, filename: a.filename ?? null, isImage, isVideo, dateCreated: message.dateCreated, thumbUrl: a.thumbUrl, originalUrl: a.originalUrl }];
      })).slice(0, cap);
    },
    "comma/queries:listConversations": async (args) => paginate(await conversations(), args.paginationOpts as Pagination),
    "comma/queries:resolveChat": async (args) => (await conversations()).find((row) => row.primaryChatGuid === args.chatGuid) ?? null,
    "comma/queries:getConversation": async (args) => (await conversations()).find((row) => row._id === args.conversationId) ?? null,
    "comma/queries:listMessages": async (args) => paginate(await messages(String(args.conversationId)), args.paginationOpts as Pagination),
    "comma/queries:searchMessages": async (args) => {
      const text = String(args.query).trim();
      if (text.length < 2) return [];
      const chatGuid = args.conversationId ? String(args.conversationId) : undefined;
      const found = await bb.queryMessages({ limit: 50, offset: 0, text, chatGuid,
        from: args.from === "me" || args.from === "them" ? args.from : undefined });
      return (found.ok ? found.value : []).map((raw) => {
        const message = mapMessage(raw, chatGuid ?? raw.chats?.[0]?.guid ?? "", names);
        const { attachments: _attachments, ...row } = messageRow(message, bb.clientKeyFor(message.guid));
        return row;
      });
    },
    "comma/queries:listScheduled": async () => {
      const [result, chats] = await Promise.all([bb.listScheduledMessages(), chatSummaries()]);
      if (!result.ok) throw new FixtureError(result.error, 502);
      const namesByGuid = new Map(chats.map((chat) => [chat.guid, chat.displayName]));
      return result.value.map((item) => mapScheduledMessage(item, namesByGuid.get(item.payload.chatGuid) ?? item.payload.chatGuid))
        .sort((a, b) => a.sendAt - b.sendAt).map((row): Infer<typeof scheduledDoc> => ({
      _id: id(`scheduled-${row.id}`), _creationTime: FIXTURE_NOW, bbId: row.id,
      conversationId: id(row.chatGuid), chatGuid: row.chatGuid, text: row.text,
      sendAt: row.sendAt, status: row.status,
      ...(row.error !== null ? { error: row.error } : {}),
      ...(row.sentAt !== null ? { sentAt: row.sentAt } : {}), updatedAt: FIXTURE_NOW,
    }));
    },
    "comma/queries:getDraft": async (args) => drafts.get(String(args.conversationId)) ?? null,
    "comma/queries:getSuggestions": async () => null,
    "comma/suggestions:getSuggestions": async (args) => {
      const chat = (await conversations()).find((row) => row._id === args.conversationId);
      const shelf = chat && shelves.get(JSON.stringify([chat.primaryChatGuid, args.model]));
      if (!chat || !shelf || chat.lastMessage?.isFromMe || shelf.basedOnMessageGuid !== chat.lastMessage?.guid) return null;
      const { basedOnMessageGuid, generatedAt, stale: _stale, ...payload } = shelf;
      return { _id: id(`shelf-${chat._id}-${args.model}`), _creationTime: generatedAt, conversationId: chat._id,
        model: args.model, anchorGuid: basedOnMessageGuid, createdAt: generatedAt, payload };
    },
    "comma/suggestions:aiStatus": async () => aiStatus(),
    "comma/queries:syncStatus": async () => [],
    "comma/drafts:setDraft": async (args) => {
      const conversationId = String(args.conversationId);
      const text = String(args.text);
      const draft = drafts.get(conversationId);
      if (!text && !draft?.attachments?.length) drafts.delete(conversationId);
      else if (draft?.text !== text) drafts.set(conversationId, { ...draft, _id: id(`draft-${conversationId}`), _creationTime: FIXTURE_NOW, conversationId: id(conversationId), text, updatedAt: Date.now(), source: "user" });
      return null;
    },
    "comma/drafts:removeDraftAttachment": async (args) => {
      const draft = drafts.get(String(args.conversationId));
      if (!draft?.attachments) return null;
      const attachments = draft.attachments.filter((a) => a.storageId !== args.storageId);
      if (!draft.text && attachments.length === 0) drafts.delete(String(args.conversationId));
      else drafts.set(String(args.conversationId), { ...draft, attachments, updatedAt: Date.now() });
      return null;
    },
    "comma/queries:listDrafts": async () => [...drafts.values()].sort((a, b) => b.updatedAt - a.updatedAt).map((d) => ({
      conversationId: d.conversationId, text: d.text, updatedAt: d.updatedAt, source: d.source ?? "user",
      ...(d.note !== undefined ? { note: d.note } : {}), attachmentCount: d.attachments?.length ?? 0,
    })),
    // Production's agent path is the internal comma/drafts:prepareDraft; the fixture takes a chat guid and finalized uploads.
    "comma/drafts:prepareDraft": async (args) => {
      const conversationId = String(args.chatGuid);
      const attachments = ((args.attachments as string[] | undefined) ?? []).map((storageId) => {
        const upload = uploads.get(storageId);
        if (!upload?.filename || !upload.mimeType) throw new FixtureError("Finalized upload not found", 400);
        return { storageId: id<"_storage">(storageId), filename: upload.filename, mimeType: upload.mimeType, size: upload.bytes.size, url: `/__fixture/media/${storageId}` };
      });
      drafts.set(conversationId, {
        _id: id(`draft-${conversationId}`), _creationTime: FIXTURE_NOW, conversationId: id(conversationId), text: String(args.text),
        updatedAt: Date.now(), source: "agent", ...(typeof args.note === "string" ? { note: args.note } : {}), ...(attachments.length ? { attachments } : {}),
      });
      return null;
    },
    "comma/drafts:clearDraft": async (args) => {
      drafts.delete(String(args.conversationId));
      return null;
    },
    "comma/outbox:enqueue": async (args) => {
      const clientKey = String(args.clientKey);
      const existing = receipts.get(clientKey);
      if (existing) return existing.id;
      const pending = inFlight.get(clientKey);
      if (pending) return pending;
      const execution = (async () => {
        const payload = args.payload as CommaOutboxPayload;
        const chatGuid = typeof args.conversationId === "string" ? args.conversationId : "";
        const conversation = (await conversations()).find((row) => row._id === chatGuid);
        if (payload.kind === "createChat" || payload.kind === "clearSuggestionLearning") {
          if (chatGuid) throw new FixtureError(`${payload.kind} must be global`, 400);
        } else if (!conversation) throw new FixtureError("Conversation not found", 400);
        const unsupported = conversation && unsupportedReason({ platform: "imessage", chatGuid: conversation.primaryChatGuid }, conversation.isGroup, payload);
        if (unsupported) throw new FixtureError(unsupported, 400);
        // Production's enqueue writes this temp row; the bridge's completion retires it.
        if (payload.kind === "send") {
          const primaryChatGuid = (await conversations()).find((row) => row._id === chatGuid)!.primaryChatGuid;
          const now = Date.now();
          temps.set(clientKey, {
            _id: id(pendingGuid(clientKey)), _creationTime: now, guid: pendingGuid(clientKey), sendState: mini.online ? "sending" : "queued",
            conversationId: id(chatGuid), chatGuid: primaryChatGuid, dateCreated: now, isFromMe: true,
            text: payload.text, service: messageService(profileRoute({ platform: "imessage", chatGuid: primaryChatGuid }, conversation?.isGroup ?? false).service), error: 0, edited: false, retracted: false,
            isTapback: false, reactions: [], ...(payload.replyToGuid ? { replyToGuid: payload.replyToGuid } : {}),
            isGroupEvent: false, mentions: payload.mentions ?? [], attachmentGuids: [], clientKey, sourceVersion: 0, attachments: [],
          });
        }
        if (payload.kind === "send") sendPayloads.set(clientKey, { chatGuid, payload });
        const finish = async () => {
          // Each lane on the Mini runs one command at a time, so a burst of sends lands one by one and a slow
          // model command holds back only the model work behind it.
          const lane = laneOf(payload.kind);
          const ordered = payload.kind === "send" || lane === "ai";
          const work = () => wait(`outbox:${payload.kind}`).then(() => execute(chatGuid, payload, clientKey));
          const run = ordered ? (turns.get(lane) ?? Promise.resolve()).then(work) : work();
          if (ordered) turns.set(lane, run.catch(() => undefined));
          const result = await run.finally(() => temps.delete(clientKey));
          const resultGuid = result && "message" in result ? result.message.guid : undefined;
          if (result && "message" in result) triage.replied(chatGuid, conversation?.lastMessage ?? null, result.message.dateCreated);
          const draft = drafts.get(chatGuid);
          if (draft && (payload.kind === "send" || (payload.kind === "sendAttachment" && draft.attachments?.some((a) => a.storageId === payload.storageId)))) {
            agent.outbox.sentDraft(draft.agentChatId);
            drafts.delete(chatGuid);
          }
          const receipt = { id: `outbox-${clientKey}`, clientKey, updatedAt: Date.now(), status: "sent" as const, ...(result ? { result } : {}), ...(resultGuid ? { resultGuid } : {}) };
          receipts.set(clientKey, receipt);
          return receipt.id;
        };
        if (payload.kind !== "send" || mini.online) return await finish();
        const queuedId = `outbox-${clientKey}`;
        receipts.set(clientKey, { id: queuedId, clientKey, status: "pending", updatedAt: Date.now() });
        const timer = setTimeout(() => {
          mini.held.delete(clientKey);
          strand(clientKey, NOT_SENT_ERROR);
        }, mini.notSentAfterMs);
        mini.held.set(clientKey, { timer, release: () => {
          const temp = temps.get(clientKey);
          if (temp) temps.set(clientKey, { ...temp, sendState: "sending" });
          finish().catch((error: unknown) => strand(clientKey, error instanceof Error ? error.message : String(error)));
        } });
        return queuedId;
      })();
      inFlight.set(clientKey, execution);
      try { return await execution; }
      finally { if (inFlight.get(clientKey) === execution) inFlight.delete(clientKey); }
    },
    "comma/outbox:getCommand": async (args) => {
      const receipt = [...receipts.values()].find((row) => row.id === args.commandId);
      if (!receipt) return null;
      const { id: commandId, ...row } = receipt;
      return { commandId, ...row };
    },
    "comma/pendingSends:cancelSend": async (args) => {
      const clientKey = String(args.clientKey);
      const receipt = receipts.get(clientKey);
      if (!receipt) return true;
      const held = mini.held.get(clientKey);
      if (receipt.status !== "pending" || !held) return false;
      clearTimeout(held.timer);
      mini.held.delete(clientKey);
      receipts.delete(clientKey);
      temps.delete(clientKey);
      return true;
    },
    "comma/pendingSends:retrySend": async (args) => {
      const clientKey = String(args.clientKey);
      const retryKey = String(args.retryKey);
      const retried = receipts.get(retryKey);
      if (retried) return retried.id;
      const sendOf = sendPayloads.get(clientKey);
      if (!sendOf || receipts.get(clientKey)?.status !== "failed") throw new FixtureError("Only a send that did not go out can be retried", 400);
      temps.delete(clientKey);
      return handlers["comma/outbox:enqueue"]!({ clientKey: retryKey, conversationId: sendOf.chatGuid, payload: sendOf.payload });
    },
    "comma/outbox:outboxStatusFor": async (args) => (args.clientKeys as string[]).slice(0, 100).flatMap((clientKey) => {
      const row = receipts.get(clientKey);
      return row ? [{ clientKey, status: row.status }] : [];
    }),
  };
  // Takes the Mini away from the outbox or brings it back; `notSentAfterMs` shortens the Not sent deadline for a drive.
  // `heartbeat: true` with `online: false` is a Mini that is up but slow to take sends.
  app.post("/__fixture/mini", async (c) => {
    const body = await c.req.json<{ online?: boolean; heartbeat?: boolean; notSentAfterMs?: number | null }>();
    if (body.notSentAfterMs !== undefined) mini.notSentAfterMs = body.notSentAfterMs ?? NOT_SENT_AFTER_MS;
    if (body.online !== undefined) mini.online = body.online;
    mini.heartbeat = body.heartbeat ?? mini.online;
    if (mini.heartbeat) mini.beatAt = new Date().getTime();
    if (mini.online) releaseHeld();
    return c.json({ ok: true });
  });
  app.post("/__fixture/latency", async (c) => {
    const { name, delayMs } = await c.req.json<{ name: string; delayMs: number | null }>();
    if (delayMs === null) latency.delete(name);
    else latency.set(name, delayMs);
    return c.json({ ok: true });
  });
  app.post("/__fixture/convex", async (c) => {
    try {
      const { name, args } = await c.req.json<{ name: string; args: Record<string, unknown> }>();
      const handler = Object.hasOwn(handlers, name) ? handlers[name] : undefined;
      if (!handler) return c.json({ error: `Unknown fixture Convex function: ${name}` }, 400);
      await wait(name);
      const inside = typeof args.conversationId === "string" ? { ...args, conversationId: fixtureChatGuid(args.conversationId) } : args;
      return Response.json(withConversationIds(await handler(inside)));
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof FixtureError ? error.status : 400 });
    }
  });
  return () => {
    for (const { timer } of mini.held.values()) clearTimeout(timer);
    mini.held.clear(); mini.online = true; mini.heartbeat = true; mini.beatAt = new Date().getTime(); mini.notSentAfterMs = NOT_SENT_AFTER_MS; sendPayloads.clear();
    turns.clear(); names.reset(); agent.reset(); today.reset(); triage.reset(); latency.clear(); drafts.clear(); receipts.clear(); inFlight.clear(); temps.clear(); shelves.clear(); peerTyping.clear(); deletedChats.clear(); uploads.clear(); transcripts.clear();
    for (const timer of typingTimers.values()) clearTimeout(timer); typingTimers.clear(); };
}
