import { routeService, type ProfileRoute } from "./platform-profile";
import type { BridgeMessage, ChatSummary, Message } from "./types";

/**
 * iMessage chat GUIDs, `<service>;<+|->;<identifier>`. The app names conversations by their Convex
 * id; this is the one place it reads a GUID.
 */
export const imessageChat = {
  isGroup(chatGuid: string): boolean {
    return chatGuid.includes(";+;");
  },
  /** The identifier after the last `;`: the other person's handle in a one-to-one chat. */
  identifier(chatGuid: string): string {
    return chatGuid.split(";").pop() ?? chatGuid;
  },
};

/** The platform and service a chat GUID sends through. */
export function chatGuidRoute(chatGuid: string): Pick<ProfileRoute, "platform" | "service"> {
  return { platform: "imessage", service: routeService(chatGuid.split(";")[0] ?? "") };
}

/** The route a conversation's commands take, as its platform profile reads it. */
export function conversationRoute(chat: Pick<ChatSummary, "route" | "isGroup">): ProfileRoute {
  return { ...chatGuidRoute(chat.route.imessage.chatGuid), platform: chat.route.platform, isGroup: chat.isGroup };
}

/** The other person's handle in a one-to-one conversation, or null for a group. */
export function dmAddress(chat: Pick<ChatSummary, "isGroup" | "participants" | "route">): string | null {
  if (chat.isGroup) return null;
  return chat.participants[0]?.address ?? imessageChat.identifier(chat.route.imessage.chatGuid);
}

/** The service a message drew in: green when SMS. A message on another platform is never SMS. */
export function serviceOf(message: Pick<Message, "imessage">): "iMessage" | "SMS" {
  return message.imessage?.service ?? "iMessage";
}

/** Whether the platform reported an error sending this message. */
export function hasSendError(message: Pick<Message, "imessage">): boolean {
  return (message.imessage?.error ?? 0) !== 0;
}

/** A bridge's flat iMessage message as a Message. */
export function fromBridgeMessage(message: BridgeMessage): Message {
  const { chatGuid, service, special, sendEffect, error, isSpam, isAssociatedMessage, ...core } = message;
  return {
    ...core,
    platform: "imessage",
    imessage: {
      chatGuid, service, special, sendEffect, error,
      ...(isSpam !== undefined ? { isSpam } : {}),
      ...(isAssociatedMessage !== undefined ? { isAssociatedMessage } : {}),
    },
  };
}
