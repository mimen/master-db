import type { FunctionArgs } from "convex/server";
import { commaApi, commaOutbox } from "./convex-api";

export type CommandPayload = FunctionArgs<typeof commaOutbox.enqueue>["payload"];

/** The two Convex client calls command routing needs; injected so tests need no module mocks. */
export interface CommandClient {
  query(ref: typeof commaApi.resolveChat, args: { chatGuid: string }): Promise<{ _id: string } | null>;
  mutation(ref: typeof commaOutbox.enqueue, args: FunctionArgs<typeof commaOutbox.enqueue>): Promise<unknown>;
}

/**
 * Queues a command on the Convex outbox when Convex sends are active and the
 * chat is mirrored. Returns false so the caller falls back to REST otherwise.
 */
export async function enqueueVia(
  client: CommandClient,
  enabled: boolean,
  chatGuid: string,
  payload: CommandPayload,
): Promise<boolean> {
  if (!enabled) return false;
  const conversation = await client.query(commaApi.resolveChat, { chatGuid });
  if (!conversation) return false;
  await client.mutation(commaOutbox.enqueue, {
    clientKey: `command-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    conversationId: conversation._id as FunctionArgs<typeof commaOutbox.enqueue>["conversationId"],
    payload,
  });
  return true;
}
