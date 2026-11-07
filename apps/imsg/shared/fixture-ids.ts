import type { ConversationId } from "./types";

/**
 * The fixture world keys conversations by chat GUID internally. At its Convex boundary each one gets an
 * id distinct from any GUID, as in production, so a GUID passed where a conversation id belongs finds
 * nothing. Fixture code only.
 */
export function fixtureConversationId(chatGuid: string): ConversationId {
  return `fx${btoa(chatGuid).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}` as ConversationId;
}

export function fixtureChatGuid(conversationId: string): string {
  if (!conversationId.startsWith("fx")) return `not-a-conversation:${conversationId}`;
  const base64 = conversationId.slice(2).replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
}
