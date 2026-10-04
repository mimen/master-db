import type { CommandResult, CommaOutboxPayload } from "../../../../../convex/schema/comma/validators";
import { aiHandlers } from "./ai";
import { mediaHandlers } from "./media";
import { messagingHandlers } from "./messaging";
import { presenceHandlers } from "./presence";
import { scheduledHandlers } from "./scheduled";
import type { CommandContext, HandlerMap } from "./types";

export const commandHandlers = { ...messagingHandlers, ...scheduledHandlers, ...mediaHandlers, ...aiHandlers, ...presenceHandlers } satisfies HandlerMap;

export function dispatchCommand(handlers: HandlerMap, context: CommandContext, payload: CommaOutboxPayload): Promise<CommandResult> {
  // The key and discriminant are the same. Keep this correlation cast at dispatch only.
  const handler = handlers[payload.kind] as { execute(ctx: CommandContext, payload: CommaOutboxPayload): Promise<CommandResult> };
  return handler.execute(context, payload);
}
