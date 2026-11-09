import type { ChatSummary, Contact, ConversationId, SendTextRequest } from "@shared/types";
import { fromBridgeMessage } from "@shared/imessage";
import { UnknownCommandError } from "./command-results";
import type { RunCommandOptions, runCommand } from "./convex-commands";

/**
 * Convex says why it refused in a ConvexError's data. Read without importing ConvexError: that import alone moves
 * convex/values into the first-visit common chunk.
 */
export function convexReason(error: unknown): string | null {
  if (!(error instanceof Error) || !("data" in error)) return null;
  const { data } = error;
  if (typeof data === "string") return data;
  return data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : null;
}

export function messagingCommandError(error: unknown, fallback: string): string {
  return error instanceof UnknownCommandError
    ? "Not sure this went through. Check the conversation before trying again."
    : convexReason(error) ?? fallback;
}

export function createMessagingApi(run: typeof runCommand) {
  return {
    // Mentions send through here, and only iMessage sends mentions.
    sendText: async (conversationId: ConversationId, body: SendTextRequest, options?: RunCommandOptions) => {
      const result = await run(conversationId, { kind: "send", ...body }, options);
      if (!("message" in result)) throw new Error("This send answered without a message");
      return fromBridgeMessage(result.message);
    },
    sendContactCard: async (conversationId: ConversationId, contact: Contact, caption?: string) =>
      fromBridgeMessage((await run(conversationId, { kind: "sendContact", name: contact.name, address: contact.address, ...(caption !== undefined ? { caption } : {}) })).message),
    newChat: async (body: { addresses: string[]; text: string }) => run(null, { kind: "createChat", ...body }),
    participant: async (conversationId: ConversationId, address: string, action: "add" | "remove") => run(conversationId, { kind: "participant", address, action }),
    leaveGroup: async (conversationId: ConversationId) => run(conversationId, { kind: "leaveGroup" }),
    deleteChat: async (chat: Pick<ChatSummary, "conversationId" | "route">) => {
      if (chat.route.platform !== "imessage") throw new Error("Only an iMessage conversation can be deleted");
      return run(chat.conversationId, { kind: "deleteChat", chatGuid: chat.route.imessage.chatGuid });
    },
    createFaceTimeLink: async (conversationId: ConversationId) => ({ message: fromBridgeMessage((await run(conversationId, { kind: "createFaceTimeLink" })).message) }),
  };
}
