import type { CommandResult, CommaOutboxPayload } from "../../../../../convex/schema/comma/validators";
import { mediaHandlers } from "./media";
import { messagingHandlers } from "./messaging";
import { presenceHandlers } from "./presence";
import { scheduledHandlers } from "./scheduled";
import type { AiContext, HandlerMap, IMessageContext, IMessageHandlers } from "./types";

/** The bridge's lane. The AI process composes the ai lane's handlers with createAiHandlers. */
export const imessageHandlers = { ...messagingHandlers, ...scheduledHandlers, ...mediaHandlers, ...presenceHandlers } satisfies IMessageHandlers;

export function dispatchCommand<C extends IMessageContext | AiContext>(handlers: HandlerMap, context: C, payload: CommaOutboxPayload): Promise<CommandResult> {
  // The key and discriminant are the same, and Convex matched the lane to the kind. Keep this correlation cast at dispatch only.
  const handler = handlers[payload.kind] as unknown as { execute(ctx: C, payload: CommaOutboxPayload): Promise<CommandResult> };
  return handler.execute(context, payload);
}
