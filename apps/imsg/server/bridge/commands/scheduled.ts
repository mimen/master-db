import type { BBScheduledMessage } from "../../bb-types";
import { mapScheduledMessage } from "../../scheduled";
import { ScheduledSendNow } from "../../scheduled-send-now";
import { publishScheduled } from "../scheduled-mirror";
import { accept, requireChat, type CommandContext, type HandlerMap } from "./types";

async function scheduledTarget(ctx: CommandContext, id: number): Promise<BBScheduledMessage> {
  if (!Number.isInteger(id) || id <= 0) throw new Error("invalid schedule id");
  const listed = await ctx.commands.bb.listScheduledMessages();
  if (!listed.ok) throw new Error(listed.error);
  const scheduled = listed.value.find((item) => Number(item.id) === id);
  if (!scheduled) throw new Error("scheduled message not found");
  if (!ctx.commands.directory.siblingGuids(requireChat(ctx)).includes(scheduled.payload.chatGuid)) {
    throw new Error("scheduled message is not in this conversation");
  }
  return scheduled;
}

async function scheduledResult(ctx: CommandContext, raw: BBScheduledMessage) {
  await publishScheduled(ctx.commands.bb, ctx.writer.deps.ingest);
  const summaries = await ctx.commands.directory.summaries();
  const name = summaries.ok ? summaries.chats.find((chat) =>
    ctx.commands.directory.siblingGuids(chat.guid).includes(raw.payload.chatGuid))?.displayName : undefined;
  return mapScheduledMessage(raw, name ?? raw.payload.chatGuid);
}

export const scheduledHandlers = {
  schedule: { execute: async (ctx, payload) => {
    const result = await ctx.commands.schedule({ ...payload, chatGuid: requireChat(ctx) });
    if (!result.ok) throw new Error(result.error);
    return { kind: "schedule", scheduled: await scheduledResult(ctx, result.value) };
  } },
  editScheduled: { execute: async (ctx, payload) => {
    const target = await scheduledTarget(ctx, payload.bbId);
    const result = await ctx.commands.schedule({ ...payload, chatGuid: target.payload.chatGuid }, payload.bbId);
    if (!result.ok) throw new Error(result.error);
    return { kind: "editScheduled", scheduled: await scheduledResult(ctx, result.value) };
  } },
  cancelScheduled: { execute: async (ctx, payload) => {
    await scheduledTarget(ctx, payload.bbId);
    accept(await ctx.commands.cancelScheduled(payload.bbId));
    await publishScheduled(ctx.commands.bb, ctx.writer.deps.ingest);
    return { kind: "cancelScheduled", ok: true };
  } },
  sendScheduledNow: { execute: async (ctx, payload) => {
    await scheduledTarget(ctx, payload.bbId);
    accept(await new ScheduledSendNow(ctx.commands.bb).send(payload.bbId));
    await publishScheduled(ctx.commands.bb, ctx.writer.deps.ingest);
    return { kind: "sendScheduledNow", ok: true };
  } },
} satisfies Partial<HandlerMap>;
