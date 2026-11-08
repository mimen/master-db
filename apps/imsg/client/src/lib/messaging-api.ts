import type { ChatSummary, Contact, ConversationId, SendTextRequest } from "@shared/types";
import { fromBridgeMessage } from "@shared/imessage";
import { UnknownCommandError } from "./command-results";
import type { RunCommandOptions, runCommand } from "./convex-commands";

export function messagingCommandError(error: unknown, fallback: string): string {
  return error instanceof UnknownCommandError
    ? "Not sure this went through. Check the conversation before trying again."
    : fallback;
}

export function createMessagingApi(run: typeof runCommand) {
  return {
    sendText: async (conversationId: ConversationId, body: SendTextRequest, options?: RunCommandOptions) => fromBridgeMessage((await run(conversationId, { kind: "send", ...body }, options)).message),
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
