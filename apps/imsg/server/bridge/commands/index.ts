import type { CommandResult, CommaOutboxPayload } from "../../../../../convex/schema/comma/validators";
import { aiHandlers } from "./ai";
import { mediaHandlers } from "./media";
import { messagingHandlers } from "./messaging";
import { presenceHandlers } from "./presence";
import { scheduledHandlers } from "./scheduled";
import type { AiContext, HandlerMap, IMessageContext } from "./types";

export const commandHandlers = { ...messagingHandlers, ...scheduledHandlers, ...mediaHandlers, ...aiHandlers, ...presenceHandlers } satisfies HandlerMap;

export function dispatchCommand<C extends IMessageContext | AiContext>(handlers: HandlerMap, context: C, payload: CommaOutboxPayload): Promise<CommandResult> {
  // The key and discriminant are the same, and the lane matched the kind. Keep this correlation cast at dispatch only.
  const handler = handlers[payload.kind] as unknown as { execute(ctx: C, payload: CommaOutboxPayload): Promise<CommandResult> };
  return handler.execute(context, payload);
}
