import { extractLinkPreview, parsePublicPreviewUrl } from "../../shared/link-preview";
import type { Hono } from "hono";
import type { GenericId, Infer } from "convex/values";
import type { attachmentDoc, conversationDoc, draftDoc, messageDoc, scheduledDoc, CommaOutboxPayload, CommandResult } from "../../../../convex/schema/comma/validators";
import { conversationKey } from "../../../../convex/comma/conversationKey";
import type { FixtureRouteControls } from "../../server/app";
import { buildThread, mapMessage } from "../../server/map";
import { ChatCommands } from "../../server/commands";
import { mapMessage } from "../../server/map";
import { WhisperService } from "../../server/whisper";
import type { OverlayDb } from "../../server/db";
import type { AiStatus, ChatSummary, Contact, ContactSuggestion, Message, ReplySuggestions, ScheduledMessage, TranscriptState } from "../../shared/types";
import type { FixtureBlueBubbles } from "./fake-bluebubbles";
import { fixtureSeed, FIXTURE_NOW, type FixtureIdentity } from "./world";

type Conversation = Infer<typeof conversationDoc> & Pick<ChatSummary, "flags" | "unreadCount"> & { groupPhotoUrl: string | null };
type ConvexMessage = Infer<typeof messageDoc> & { attachments: Array<Infer<typeof attachmentDoc> & { thumbUrl: string | null; originalUrl: string | null }> };
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
      thumbUrl: a.mimeType?.startsWith("image/") ? `/__fixture/media/${encodeURIComponent(a.guid)}` : null,
      originalUrl: `/__fixture/media/${encodeURIComponent(a.guid)}`, sourceVersion: 1,
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
  const receipts = new Map<string, { id: string; status: "sent"; clientKey: string; updatedAt: number; result?: CommandResult; resultGuid?: string }>();
  const shelves = new Map<string, ReplySuggestions>();
  const deletedChats = new Set<string>();
  const uploads = new Map<string, { bytes: Blob; filename?: string; mimeType?: string }>();
  const transcripts = new Map<string, TranscriptState>();
  const inFlight = new Map<string, Promise<string>>();
  const peerTyping = new Map<string, { peerTyping: boolean; updatedAt: number; expiresAt: number }>();
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const unsubscribeTyping = bb.onEvent((event) => {
    if (event.kind === "typing") {
      const now = Date.now();
      peerTyping.set(controls.directory.canonicalGuid(event.chatGuid), { peerTyping: event.display, updatedAt: now, expiresAt: now + (event.display ? 12_000 : 0) });
    } else if (event.kind === "stream-connected") peerTyping.clear();
  });
  const commands = new ChatCommands(bb, controls.directory, names, () => controls.broadcast({ kind: "chats-changed" }));
  const read = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await app.request(path, init);
    if (!response.ok) throw new FixtureError(await response.text(), response.status);
    return response.json() as Promise<T>;
  };
  const accept = (result: { ok: boolean; error?: string; status?: number }) => {
    if (!result.ok) throw new FixtureError(result.error ?? "BlueBubbles operation failed", result.status);
  };
  const conversations = async () => Promise.all((await read<ChatSummary[]>("/api/chats?state=any")).filter((chat) => !deletedChats.has(chat.guid)).map(async (chat) => {
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
    if (deletedChats.has(chatGuid)) return [];
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
  const execute = async (chatGuid: string, payload: CommaOutboxPayload, clientKey: string): Promise<CommandResult | undefined> => {
    const directory = controls.directory;
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
        controls.broadcast({ kind: "chats-changed" });
        const transcript = await WhisperService.forCache(db)!.transcribe(payload.attachmentGuid);
        transcripts.set(payload.attachmentGuid, transcript);
        return { kind: "transcribe" as const, transcript };
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
      case "typing": {
        if (payload.active && payload.expiresAt <= Date.now()) return { kind: "typing" as const, ok: true as const };
        const timer = typingTimers.get(chatGuid);
        if (timer) clearTimeout(timer);
        typingTimers.delete(chatGuid);
        accept(await bb.setTyping(chatGuid, payload.active));
        if (payload.active) {
          const expiry = setTimeout(() => { typingTimers.delete(chatGuid); void bb.setTyping(chatGuid, false); }, Math.max(0, payload.expiresAt - Date.now()));
          expiry.unref(); typingTimers.set(chatGuid, expiry);
        }
        return { kind: "typing" as const, ok: true as const };
      }
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
          const message = mapMessage(result.value, chatGuid, names);
          directory.applyKnownMessage(chatGuid, message);
          return { kind: "sendContact", message };
        }
        break;
      }
      case "participant": accept(await commands.participant(chatGuid, payload.address, payload.action)); break;
      case "leaveGroup": accept(await commands.leaveGroup(chatGuid)); break;
      case "deleteChat":
        if (payload.chatGuid !== chatGuid) throw new FixtureError("Chat alias is not in this conversation", 400);
        accept(await commands.deleteChat(payload.chatGuid));
        db.deleteSuggestionFeedbackForChat(payload.chatGuid);
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
    if (["react", "edit", "unsend", "delete", "markRead", "markUnread", "pin", "mute", "settle", "unsettle", "rename", "participant", "leaveGroup", "deleteChat", "cancelScheduled"].includes(payload.kind)) {
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
    const storageId = `fixture-storage-${uploads.size + 1}`;
    uploads.set(storageId, { bytes: await c.req.blob() });
    return c.json({ storageId });
  });
  app.get("/__fixture/media/:guid", (c) => {
    const upload = uploads.get(c.req.param("guid"));
    return upload ? new Response(upload.bytes) : bb.downloadAttachment(c.req.param("guid"));
  });
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
    "comma/presence:presence": async (args) => {
      const row = peerTyping.get(controls.directory.canonicalGuid(String(args.conversationId)));
      return row ? { ...row, peerTyping: row.peerTyping && row.expiresAt > Date.now() } : null;
    },
    "comma/bridgeState:bridgeState": async () => {
      const health = await read<{ privateApi: boolean }>("/api/health");
      const ai = await read<{ suggestions: boolean; reactionSuggestions: boolean }>("/api/ai/status");
      return { key: "mini", ...health, ...ai, whisperAvailable: false, whisperDetail: "Fixture transcription unavailable", lastSeenAt: Date.now() };
    },
    "comma/uploads:generateAttachmentUploadUrl": async () => "/__fixture/upload",
    "comma/uploads:finalizeUpload": async (args) => {
      const upload = uploads.get(String(args.storageId));
      if (!upload) throw new FixtureError("Uploaded file not found", 400);
      if (!args.filename || upload.bytes.type !== args.mimeType || !upload.bytes.size) throw new FixtureError("Invalid upload metadata", 400);
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
        const chatGuid = typeof args.conversationId === "string" ? args.conversationId : "";
        if (payload.kind === "createChat" || payload.kind === "clearSuggestionLearning") {
          if (chatGuid) throw new FixtureError(`${payload.kind} must be global`, 400);
        } else if (!(await conversations()).some((row) => row._id === chatGuid)) throw new FixtureError("Conversation not found", 400);
        const result = await execute(chatGuid, payload, clientKey);
        const resultGuid = result && "message" in result ? result.message.guid : undefined;
        if (payload.kind === "send") drafts.delete(chatGuid);
        const receipt = { id: `outbox-${clientKey}`, clientKey, updatedAt: Date.now(), status: "sent" as const, ...(result ? { result } : {}), ...(resultGuid ? { resultGuid } : {}) };
        receipts.set(clientKey, receipt);
        controls.broadcast({ kind: "chats-changed" });
        return receipt.id;
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
  return () => { drafts.clear(); receipts.clear(); inFlight.clear(); shelves.clear(); peerTyping.clear(); deletedChats.clear(); uploads.clear(); transcripts.clear();
    unsubscribeTyping(); for (const timer of typingTimers.values()) clearTimeout(timer); typingTimers.clear(); };
}
