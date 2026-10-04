import { UnknownSendError } from "../../commands";
import { deleteMirroredChat } from "./messaging-ingest";
import { accept, requireChat, type HandlerMap } from "./types";

export const messagingHandlers = {
  send: { execute: async (ctx, payload) => {
    const sent = await ctx.commands.send(requireChat(ctx), payload, ctx.row.clientKey);
    if (!sent.ok) throw new Error(sent.error);
    return { kind: "send", message: sent.value };
  } },
  react: { execute: async (ctx, payload) => {
    accept(await ctx.commands.react(payload.messageGuid, { ...payload, chatGuid: requireChat(ctx) }));
    return { kind: "react", ok: true };
  } },
  edit: { execute: async (ctx, payload) => {
    accept(await ctx.commands.edit(payload.messageGuid, payload.text, payload.partIndex));
    return { kind: "edit", ok: true };
  } },
  unsend: { execute: async (ctx, payload) => {
    accept(await ctx.commands.unsend(payload.messageGuid, payload.partIndex));
    return { kind: "unsend", ok: true };
  } },
  delete: { execute: async (ctx, payload) => {
    accept(await ctx.commands.delete(payload.messageGuid, requireChat(ctx)));
    return { kind: "delete", ok: true };
  } },
  markRead: { execute: async (ctx) => {
    accept({ ok: await ctx.commands.markRead(requireChat(ctx)), error: "BlueBubbles mark read failed" });
    return { kind: "markRead", ok: true };
  } },
  markUnread: { execute: async (ctx) => {
    ctx.commands.directory.markUnread(requireChat(ctx));
    return { kind: "markUnread", ok: true };
  } },
  pin: { execute: async (ctx, payload) => {
    ctx.commands.directory.setPinned(requireChat(ctx), payload.value);
    return { kind: "pin", ok: true };
  } },
  mute: { execute: async (ctx, payload) => {
    ctx.writer.deps.db.setMutedUnresponded(requireChat(ctx), payload.value);
    ctx.commands.directory.invalidate();
    return { kind: "mute", ok: true };
  } },
  settle: { execute: async (ctx, payload) => {
    const chatGuid = requireChat(ctx);
    const directory = ctx.commands.directory;
    const summaries = await directory.summaries();
    if (!summaries.ok) throw new Error(summaries.error);
    const chat = summaries.chats.find((item) => item.guid === directory.canonicalGuid(chatGuid));
    accept(await directory.dismiss(chatGuid, chat?.lastMessage?.isFromMe ? "waiting" : "unresponded", payload.messageGuid));
    return { kind: "settle", ok: true };
  } },
  unsettle: { execute: async (ctx) => {
    const chatGuid = requireChat(ctx);
    accept(await ctx.commands.directory.undismiss(chatGuid, "unresponded"));
    accept(await ctx.commands.directory.undismiss(chatGuid, "waiting"));
    return { kind: "unsettle", ok: true };
  } },
  rename: { execute: async (ctx, payload) => {
    accept(await ctx.commands.rename(requireChat(ctx), payload.name));
    return { kind: "rename", ok: true };
  } },
  createChat: { longRunning: true, execute: async (ctx, payload) => {
    if (ctx.chatGuid) throw new Error("createChat must be global");
    const result = await ctx.commands.createChat(payload);
    if (!result.ok) throw new Error(result.error);
    const { chat, message } = result.value;
    await mirrorAfterEffect(() => ctx.writer.exclusive(async () => {
      await ctx.writer.ensureChat(chat.guid);
      await ctx.writer.postMessages([{ ...chat.lastMessage!, chats: [{ guid: chat.guid }] }]);
    }));
    return { kind: "createChat", chatGuid: chat.guid, service: "iMessage", isGroup: payload.addresses.length > 1,
      participants: (chat.participants ?? []).map((p) => p.address), message };
  } },
  sendContact: { longRunning: true, execute: async (ctx, payload) => {
    const result = await ctx.commands.sendContact(requireChat(ctx), payload);
    if (!result.ok) throw new Error(result.error);
    return { kind: "sendContact", message: result.value };
  } },
  participant: { longRunning: true, execute: async (ctx, payload) => {
    accept(await ctx.commands.participant(requireChat(ctx), payload.address, payload.action));
    await mirrorAfterEffect(() => ctx.writer.exclusive(() => ctx.writer.refreshChats()));
    return { kind: "participant", ok: true };
  } },
  leaveGroup: { longRunning: true, execute: async (ctx) => {
    accept(await ctx.commands.leaveGroup(requireChat(ctx)));
    await mirrorAfterEffect(() => ctx.writer.exclusive(() => ctx.writer.refreshChats()));
    return { kind: "leaveGroup", ok: true };
  } },
  deleteChat: { longRunning: true, execute: async (ctx, payload) => {
    if (!ctx.commands.directory.siblingGuids(requireChat(ctx)).includes(payload.chatGuid)) {
      throw new Error("Chat alias is not in this conversation");
    }
    accept(await ctx.commands.deleteChat(payload.chatGuid));
    await mirrorAfterEffect(() => ctx.writer.exclusive(async () => {
      ctx.writer.deps.db.deleteSuggestionFeedbackForChat(payload.chatGuid);
      await deleteMirroredChat(ctx.writer.deps.ingest, payload.chatGuid, ctx.signal);
      ctx.writer.conversationIds.delete(payload.chatGuid);
      await ctx.writer.refreshChats();
    }));
    return { kind: "deleteChat", ok: true };
  } },
  createFaceTimeLink: { longRunning: true, execute: async (ctx) => {
    const result = await ctx.commands.createFaceTimeLink(requireChat(ctx));
    if (!result.ok) throw new Error(result.error);
    return { kind: "createFaceTimeLink", message: result.value };
  } },
} satisfies Partial<HandlerMap>;

async function mirrorAfterEffect(work: () => Promise<void>): Promise<void> {
  try { await work(); }
  catch (error) { throw new UnknownSendError(`Operation completed but mirror outcome is unknown: ${String(error)}`); }
}
