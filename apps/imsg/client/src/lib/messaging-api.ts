import type { Contact, SendTextRequest } from "@shared/types";
import { UnknownCommandError } from "./command-results";
import type { RunCommandOptions, runCommand } from "./convex-commands";

export function messagingCommandError(error: unknown, fallback: string): string {
  return error instanceof UnknownCommandError
    ? "Not sure this went through. Check the conversation before trying again."
    : fallback;
}

export function createMessagingApi(run: typeof runCommand) {
  return {
    sendText: async (chatGuid: string, body: SendTextRequest, options?: RunCommandOptions) => (await run(chatGuid, { kind: "send", ...body }, options)).message,
    sendContactCard: async (chatGuid: string, contact: Contact, caption?: string) =>
      (await run(chatGuid, { kind: "sendContact", name: contact.name, address: contact.address, ...(caption !== undefined ? { caption } : {}) })).message,
    newChat: async (body: { addresses: string[]; text: string }) => run(null, { kind: "createChat", ...body }),
    participant: async (chatGuid: string, address: string, action: "add" | "remove") => run(chatGuid, { kind: "participant", address, action }),
    leaveGroup: async (chatGuid: string) => run(chatGuid, { kind: "leaveGroup" }),
    deleteChat: async (chatGuid: string) => run(chatGuid, { kind: "deleteChat", chatGuid }),
    createFaceTimeLink: async (chatGuid: string) => ({ message: (await run(chatGuid, { kind: "createFaceTimeLink" })).message }),
  };
}
