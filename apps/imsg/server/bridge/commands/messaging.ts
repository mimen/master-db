import { accept, notImplemented, requireChat, type HandlerMap } from "./types";

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
  createChat: notImplemented<"createChat">(),
  sendContact: notImplemented<"sendContact">(),
  participant: notImplemented<"participant">(),
  leaveGroup: notImplemented<"leaveGroup">(),
  deleteChat: notImplemented<"deleteChat">(),
  createFaceTimeLink: notImplemented<"createFaceTimeLink">(),
} satisfies Partial<HandlerMap>;
