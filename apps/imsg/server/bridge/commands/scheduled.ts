import { mapScheduledMessage } from "../../scheduled";
import { accept, notImplemented, requireChat, type HandlerMap } from "./types";

export const scheduledHandlers = {
  schedule: { execute: async (ctx, payload) => {
    const chatGuid = requireChat(ctx);
    const result = await ctx.commands.schedule({ ...payload, chatGuid });
    if (!result.ok) throw new Error(result.error);
    const summaries = await ctx.commands.directory.summaries();
    const name = summaries.ok ? summaries.chats.find((chat) => chat.guid === chatGuid)?.displayName : undefined;
    return { kind: "schedule", scheduled: mapScheduledMessage(result.value, name ?? chatGuid) };
  } },
  editScheduled: { execute: async (ctx, payload) => {
    const chatGuid = requireChat(ctx);
    const result = await ctx.commands.schedule({ ...payload, chatGuid }, payload.bbId);
    if (!result.ok) throw new Error(result.error);
    const summaries = await ctx.commands.directory.summaries();
    const name = summaries.ok ? summaries.chats.find((chat) => chat.guid === chatGuid)?.displayName : undefined;
    return { kind: "editScheduled", scheduled: mapScheduledMessage(result.value, name ?? chatGuid) };
  } },
  cancelScheduled: { execute: async (ctx, payload) => {
    accept(await ctx.commands.cancelScheduled(payload.bbId));
    return { kind: "cancelScheduled", ok: true };
  } },
  sendScheduledNow: notImplemented<"sendScheduledNow">(),
} satisfies Partial<HandlerMap>;
