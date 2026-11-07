import { routeService, type ProfileRoute } from "./platform-profile";
import type { ChatSummary } from "./types";

/**
 * iMessage chat GUIDs, `<service>;<+|->;<identifier>`. The app names conversations by their Convex
 * id; this is the one place it reads a GUID.
 */
export const imessageChat = {
  /**
   * The service a chat sends through. RCS counts as SMS: BlueBubbles labels the chat "RCS;-;…" but
   * reports its messages as SMS, so an optimistic send in an RCS chat must draw green too.
   */
  service(chatGuid: string): "iMessage" | "SMS" | null {
    const prefix = chatGuid.split(";")[0];
    if (prefix === "iMessage") return "iMessage";
    if (prefix === "SMS" || prefix === "RCS") return "SMS";
    return null;
  },
  isGroup(chatGuid: string): boolean {
    return chatGuid.includes(";+;");
  },
  /** The identifier after the last `;`: the other person's handle in a one-to-one chat. */
  identifier(chatGuid: string): string {
    return chatGuid.split(";").pop() ?? chatGuid;
  },
};

/** The service a conversation sends through; green when SMS. */
export function conversationService(chat: Pick<ChatSummary, "imessage">): "iMessage" | "SMS" {
  return imessageChat.service(chat.imessage.chatGuid) === "SMS" ? "SMS" : "iMessage";
}

/** The route a conversation's commands take, as its platform profile reads it. */
export function conversationRoute(chat: Pick<ChatSummary, "imessage" | "isGroup">): ProfileRoute {
  return { platform: "imessage", service: routeService(chat.imessage.chatGuid.split(";")[0] ?? ""), isGroup: chat.isGroup };
}

/** The other person's handle in a one-to-one conversation, or null for a group. */
export function dmAddress(chat: Pick<ChatSummary, "isGroup" | "participants" | "imessage">): string | null {
  if (chat.isGroup) return null;
  return chat.participants[0]?.address ?? imessageChat.identifier(chat.imessage.chatGuid);
}
