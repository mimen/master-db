import { extractLinkPreview, parsePublicPreviewUrl } from "../../shared/link-preview";
import type { Hono } from "hono";
import type { GenericId, Infer } from "convex/values";
import type { attachmentDoc, conversationDoc, draftDoc, messageDoc, scheduledDoc, CommaOutboxPayload, CommandResult } from "../../../../convex/schema/comma/validators";
import { conversationKey } from "../../../../convex/comma/conversationKey";
import type { FixtureRouteControls } from "../../server/app";
import { buildThread } from "../../server/map";
import { ChatCommands } from "../../server/commands";
import type { OverlayDb } from "../../server/db";
import type { AiStatus, ChatSummary, Contact, ContactSuggestion, Message, ReplySuggestions, ScheduledMessage } from "../../shared/types";
import type { FixtureBlueBubbles } from "./fake-bluebubbles";
import { fixtureSeed, FIXTURE_NOW, type FixtureIdentity } from "./world";

type Conversation = Infer<typeof conversationDoc> & Pick<ChatSummary, "flags" | "unreadCount"> & { groupPhotoUrl: string | null };
type ConvexMessage = Infer<typeof messageDoc> & { attachments: Array<Infer<typeof attachmentDoc> & { thumbUrl: null; originalUrl: null }> };
type Pagination = { numItems: number; cursor: string | null };

function id<Table extends string>(value: string): GenericId<Table> {
  return value as GenericId<Table>;
}

export function conversationRow(chat: ChatSummary): Conversation {
  return {
    _id: id(chat.guid), _creationTime: FIXTURE_NOW,
    conversationKey: conversationKey({ isGroup: chat.isGroup, primaryChatGuid: chat.guid, participants: chat.participants }),
    primaryChatGuid: chat.guid, chatGuids: [chat.guid],
    displayName: chat.displayName, isGroup: chat.isGroup, participants: chat.participants,
    ...(chat.lastMessage ? { lastMessage: chat.lastMessage } : {}),
    lastMessageAt: chat.lastMessage?.dateCreated ?? 0, isSpam: chat.isSpam,
    hasGroupPhoto: chat.hasGroupPhoto ?? false, groupPhotoUrl: chat.groupPhotoUrl ?? null, updatedAt: FIXTURE_NOW,
    flags: chat.flags, unreadCount: chat.unreadCount,
  };
}

export function messageRow(message: Message, clientKey?: string): ConvexMessage {
  const conversationId = id<"comma_conversations">(message.chatGuid);
  return {
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
      thumbUrl: null, originalUrl: null, sourceVersion: 1,
    })),
  };
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
  const rows = buildThread(result.value, chatGuid, names);
  const bound = bounds[0];
  const window = args.around !== undefined
    ? [...rows.filter((row) => row.dateCreated <= bound).slice(-40), ...rows.filter((row) => row.dateCreated > bound).slice(0, 40)]
    : args.before !== undefined ? rows.filter((row) => row.dateCreated < bound).slice(-40)
      : rows.filter((row) => row.dateCreated > bound).slice(0, 40);
  return window.map((message) => messageRow(message, bb.clientKeyFor(message.guid)));
}

export function registerConvexFixture(app: Hono, controls: FixtureRouteControls, bb: FixtureBlueBubbles, db: OverlayDb, names: FixtureIdentity, additionalHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {}) {
  const drafts = new Map<string, Infer<typeof draftDoc>>();
  const receipts = new Map<string, { id: string; status: "sent"; resultGuid?: string; result?: CommandResult }>();
  const shelves = new Map<string, ReplySuggestions>();
  const inFlight = new Map<string, Promise<string>>();
  const commands = new ChatCommands(bb, controls.directory, names, () => controls.broadcast({ kind: "chats-changed" }));
  const read = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await app.request(path, init);
    if (!response.ok) throw new FixtureError(await response.text(), response.status);
    return response.json() as Promise<T>;
  };
  const accept = (result: { ok: boolean; error?: string; status?: number }) => {
    if (!result.ok) throw new FixtureError(result.error ?? "BlueBubbles operation failed", result.status);
  };
  const conversations = async () => Promise.all((await read<ChatSummary[]>("/api/chats?state=any")).map(async (chat) => {
    const raw = await bb.getChat(chat.guid);
    const row = conversationRow(chat);
    return { ...row, chatGuids: controls.directory.siblingGuids(chat.guid), rawDisplayName: raw.ok ? raw.value.displayName ?? "" : "" };
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
    const rows: Message[] = [];
    let before: number | undefined;
    for (;;) {
      const batch = await read<Message[]>(`/api/chats/${encodeURIComponent(chatGuid)}/messages${before ? `?before=${before}` : ""}`);
      if (batch.length === 0) break;
      rows.push(...batch);
      const oldest = Math.min(...batch.map((m) => m.dateCreated));
      if (before !== undefined && oldest >= before) break;
      before = oldest;
    }
    return rows.sort((a, b) => b.dateCreated - a.dateCreated).map((m) => messageRow(m, bb.clientKeyFor(m.guid)));
  };
  const execute = async (chatGuid: string, payload: CommaOutboxPayload, clientKey: string) => {
    const directory = controls.directory;
    switch (payload.kind) {
      case "send": {
        const result = await commands.send(chatGuid, payload, clientKey);
        accept(result);
        if (result.ok) return { kind: "send" as const, message: { ...result.value, mentions: result.value.mentions ?? [] } };
        break;
      }
      case "markRead": accept({ ok: await commands.markRead(chatGuid) }); break;
      case "markUnread": directory.markUnread(chatGuid); break;
      case "pin": directory.setPinned(chatGuid, payload.value); break;
      case "mute": db.setMutedUnresponded(chatGuid, payload.value); directory.invalidate(); break;
      case "settle": {
        const chat = (await conversations()).find((row) => row._id === chatGuid);
        accept(await directory.dismiss(chatGuid, chat?.lastMessage?.isFromMe ? "waiting" : "unresponded", payload.messageGuid));
        break;
      }
      case "unsettle":
        accept(await directory.undismiss(chatGuid, "unresponded"));
        accept(await directory.undismiss(chatGuid, "waiting"));
        break;
      case "react": accept(await commands.react(payload.messageGuid, { ...payload, chatGuid })); break;
      case "edit": accept(await commands.edit(payload.messageGuid, payload.text, payload.partIndex)); break;
      case "unsend": accept(await commands.unsend(payload.messageGuid, payload.partIndex)); break;
      case "delete": accept(await commands.delete(payload.messageGuid, chatGuid)); break;
      case "rename": accept(await commands.rename(chatGuid, payload.name)); break;
      case "schedule": accept(await commands.schedule({ ...payload, chatGuid })); break;
      case "editScheduled": accept(await commands.schedule({ ...payload, chatGuid }, payload.bbId)); break;
      case "cancelScheduled": accept(await commands.cancelScheduled(payload.bbId)); break;
      case "suggestions": {
        const generated = await read<ReplySuggestions>(`/api/ai/suggestions/${encodeURIComponent(chatGuid)}?model=${payload.model}${payload.refresh ? "&refresh=1" : ""}`);
        const suggestions = { ...generated, event: generated.event ?? null };
        if (!suggestions.stale) shelves.set(JSON.stringify([chatGuid, payload.model]), suggestions);
        return { kind: "suggestions" as const, suggestions };
      }
      case "suggestionFeedback":
        await read(`/api/ai/suggestions/${encodeURIComponent(chatGuid)}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload.feedback) });
        return { kind: "suggestionFeedback" as const, ok: true as const };
      case "clearSuggestionLearning":
        await read("/api/ai/suggestions/learning", { method: "DELETE" });
        shelves.clear();
        return { kind: "clearSuggestionLearning" as const, ok: true as const };
      case "identify":
        return { kind: "identify" as const, contact: await read<ContactSuggestion>(`/api/ai/identify/${encodeURIComponent(chatGuid)}`) };
      default: {
        throw new FixtureError(`Unknown fixture outbox command: ${JSON.stringify(payload)}`, 400);
      }
    }
    return undefined;
  };
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "comma/linkPreview:fetchLinkPreview": async (args) => {
      const url = typeof args.url === "string" ? parsePublicPreviewUrl(args.url) : null;
      return url ? extractLinkPreview('<title>Fixture link preview</title><meta name="description" content="A deterministic preview for fixture messages.">', url) : null;
    },
    ...additionalHandlers,
    "identity/queries:searchContacts": async (args) => searchContacts(String(args.q), args.limit === undefined ? 25 : Number(args.limit)),
    "comma/conversationInfo:findChat": async (args) => {
      const key = conversationKey({ isGroup: false, primaryChatGuid: "", participants: [{ address: String(args.address), name: null }] });
      const row = (await conversations()).find((row) => !row.isGroup && row.participants.length === 1 && row.conversationKey === key);
      const guid = args.service ? row?.chatGuids.find((guid) => args.service === "SMS" ? /^(SMS|RCS);/.test(guid) : guid.startsWith("iMessage;")) : row?.primaryChatGuid;
      return row && guid ? { chatGuid: guid, service: guid.startsWith("iMessage;") ? "iMessage" : "SMS", isGroup: false, participants: row.participants.map((p) => p.address) } : null;
    },
    "comma/conversationInfo:chatInfo": async (args) => {
      const row = (await conversations()).find((row) => row.chatGuids.includes(String(args.chatGuid)));
      return row ? { guid: String(args.chatGuid), displayName: row.rawDisplayName || null, isGroup: row.isGroup,
        participants: row.participants.map((p) => ({ address: p.address, name: names.lookup(p.address) ?? p.name ?? p.address, is_favorite: names.personCrm(p.address)?.is_favorite })) } : null;
    },
    "comma/queries:listConversations": async (args) => paginate(await conversations(), args.paginationOpts as Pagination),
    "comma/queries:resolveChat": async (args) => (await conversations()).find((row) => row.primaryChatGuid === args.chatGuid) ?? null,
    "comma/queries:getConversation": async (args) => (await conversations()).find((row) => row._id === args.conversationId) ?? null,
    "comma/queries:listMessages": async (args) => paginate(await messages(String(args.conversationId)), args.paginationOpts as Pagination),
    "comma/queries:searchMessages": async (args) => {
      const params = new URLSearchParams({ q: String(args.query) });
      if (args.conversationId) params.set("chat", String(args.conversationId));
      if (args.from) params.set("from", String(args.from));
      return (await read<Message[]>(`/api/search?${params}`)).map((message) => {
        const { attachments: _attachments, ...row } = messageRow(message, bb.clientKeyFor(message.guid));
        return row;
      });
    },
    "comma/queries:listScheduled": async () => (await read<ScheduledMessage[]>("/api/scheduled")).map((row): Infer<typeof scheduledDoc> => ({
      _id: id(`scheduled-${row.id}`), _creationTime: FIXTURE_NOW, bbId: row.id,
      conversationId: id(row.chatGuid), chatGuid: row.chatGuid, text: row.text,
      sendAt: row.sendAt, status: row.status,
      ...(row.error !== null ? { error: row.error } : {}),
      ...(row.sentAt !== null ? { sentAt: row.sentAt } : {}), updatedAt: FIXTURE_NOW,
    })),
    "comma/queries:getDraft": async (args) => drafts.get(String(args.conversationId)) ?? null,
    "comma/queries:getSuggestions": async () => null,
    "comma/suggestions:getSuggestions": async (args) => {
      const chat = (await conversations()).find((row) => row.primaryChatGuid === args.chatGuid);
      const shelf = shelves.get(JSON.stringify([args.chatGuid, args.model]));
      if (!chat || !shelf || chat.lastMessage?.isFromMe || shelf.basedOnMessageGuid !== chat.lastMessage?.guid) return null;
      const { basedOnMessageGuid, generatedAt, stale: _stale, ...payload } = shelf;
      return { _id: id(`shelf-${chat._id}-${args.model}`), _creationTime: generatedAt, conversationId: chat._id,
        model: args.model, anchorGuid: basedOnMessageGuid, createdAt: generatedAt, payload };
    },
    "comma/suggestions:aiStatus": async () => read<AiStatus>("/api/ai/status"),
    "comma/queries:syncStatus": async () => [],
    "comma/drafts:setDraft": async (args) => {
      const conversationId = String(args.conversationId);
      const text = String(args.text);
      if (text) drafts.set(conversationId, { _id: id(`draft-${conversationId}`), _creationTime: FIXTURE_NOW, conversationId: id(conversationId), text, updatedAt: FIXTURE_NOW });
      else drafts.delete(conversationId);
      controls.broadcast({ kind: "chats-changed" });
      return null;
    },
    "comma/drafts:clearDraft": async (args) => {
      drafts.delete(String(args.conversationId));
      controls.broadcast({ kind: "chats-changed" });
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
        const chatGuid = args.conversationId ? String(args.conversationId) : "";
        if (payload.kind !== "clearSuggestionLearning" && !(await conversations()).some((row) => row._id === chatGuid)) throw new FixtureError("Conversation not found", 400);
        const result = await execute(chatGuid, payload, clientKey);
        const resultGuid = result?.kind === "send" ? result.message.guid : undefined;
        if (payload.kind === "send") drafts.delete(chatGuid);
        const receipt = { id: `outbox-${clientKey}`, status: "sent" as const, ...(resultGuid ? { resultGuid } : {}), ...(result ? { result } : {}) };
        receipts.set(clientKey, receipt);
        controls.broadcast({ kind: "chats-changed" });
        return receipt.id;
      })();
      inFlight.set(clientKey, execution);
      try { return await execution; }
      finally { if (inFlight.get(clientKey) === execution) inFlight.delete(clientKey); }
    },
    "comma/outbox:getCommand": async (args) => {
      const entry = [...receipts.entries()].find(([, row]) => row.id === args.commandId);
      if (!entry) return null;
      const [clientKey, row] = entry;
      return { commandId: row.id, clientKey, status: row.status, updatedAt: FIXTURE_NOW,
        ...(row.resultGuid ? { resultGuid: row.resultGuid } : {}), ...(row.result ? { result: row.result } : {}) };
    },
    "comma/outbox:outboxStatusFor": async (args) => (args.clientKeys as string[]).slice(0, 100).flatMap((clientKey) => {
      const row = receipts.get(clientKey);
      return row ? [{ clientKey, status: row.status }] : [];
    }),
  };
  app.post("/__fixture/convex", async (c) => {
    try {
      const { name, args } = await c.req.json<{ name: string; args: Record<string, unknown> }>();
      const handler = Object.hasOwn(handlers, name) ? handlers[name] : undefined;
      if (!handler) return c.json({ error: `Unknown fixture Convex function: ${name}` }, 400);
      return Response.json(await handler(args));
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof FixtureError ? error.status : 400 });
    }
  });
  return () => { drafts.clear(); receipts.clear(); inFlight.clear(); shelves.clear(); };
}
