import type { Hono } from "hono";
import type { GenericId, Infer } from "convex/values";
import type { attachmentDoc, conversationDoc, draftDoc, messageDoc, scheduledDoc, CommaOutboxPayload, CommandResult } from "../../../../convex/schema/comma/validators";
import { conversationKey } from "../../../../convex/comma/conversationKey";
import type { FixtureRouteControls } from "../../server/app";
import { mapMessage } from "../../server/map";
import { ChatCommands } from "../../server/commands";
import type { OverlayDb } from "../../server/db";
import type { ChatSummary, Message, ScheduledMessage } from "../../shared/types";
import type { FixtureBlueBubbles } from "./fake-bluebubbles";
import { FIXTURE_NOW, type FixtureIdentity } from "./world";

type Conversation = Infer<typeof conversationDoc> & Pick<ChatSummary, "flags" | "unreadCount">;
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
    hasGroupPhoto: chat.hasGroupPhoto ?? false, updatedAt: FIXTURE_NOW,
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

export function registerConvexFixture(app: Hono, controls: FixtureRouteControls, bb: FixtureBlueBubbles, db: OverlayDb, names: FixtureIdentity) {
  const drafts = new Map<string, Infer<typeof draftDoc>>();
  const receipts = new Map<string, { id: string; status: "sent"; clientKey: string; updatedAt: number; result?: CommandResult; resultGuid?: string }>();
  const deletedChats = new Set<string>();
  const inFlight = new Map<string, Promise<string>>();
  const commands = new ChatCommands(bb, controls.directory, names, () => controls.broadcast({ kind: "chats-changed" }));
  const read = async <T>(path: string): Promise<T> => {
    const response = await app.request(path);
    if (!response.ok) throw new FixtureError(await response.text(), response.status);
    return response.json() as Promise<T>;
  };
  const accept = (result: { ok: boolean; error?: string; status?: number }) => {
    if (!result.ok) throw new FixtureError(result.error ?? "BlueBubbles operation failed", result.status);
  };
  const conversations = async () => (await read<ChatSummary[]>("/api/chats?state=any")).filter((chat) => !deletedChats.has(chat.guid)).map(conversationRow);
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
        if (result.ok) return { kind: "send", message: result.value };
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
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "comma/queries:listConversations": async (args) => paginate(await conversations(), args.paginationOpts as Pagination),
    "comma/queries:resolveChat": async (args) => (await conversations()).find((row) => row.primaryChatGuid === args.chatGuid) ?? null,
    "comma/queries:getConversation": async (args) => (await conversations()).find((row) => row._id === args.conversationId) ?? null,
    "comma/queries:listMessages": async (args) => paginate(await messages(String(args.conversationId)), args.paginationOpts as Pagination),
    "comma/queries:searchMessages": async (args) => {
      const params = new URLSearchParams({ q: String(args.query) });
      if (args.conversationId) params.set("chat", String(args.conversationId));
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
        if (payload.kind === "createChat") {
          if (chatGuid) throw new FixtureError("createChat must be global", 400);
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
  return () => { drafts.clear(); receipts.clear(); inFlight.clear(); deletedChats.clear(); };
}
