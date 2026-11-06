import { isValidPhoneNumber } from "libphonenumber-js";

import { stripServiceSuffix } from "../../apps/imsg/shared/address";
import type { Participant } from "../../apps/imsg/shared/types";
import { normalizePhone } from "../identity/normalize";
import type { CommaPlatform, CommaRoute } from "../schema/comma/validators";

/**
 * What makes two platform threads one Comma conversation, and which thread a command goes through.
 * A conversation is identified by (platform, conversationKey); the app and core logic use only its
 * Convex id. This file is pure so the Mini's bridge groups chats with the same rules Convex keys
 * them by. Convex's reads live in conversationLookup.ts.
 */

/** The key a one-to-one conversation with this handle has, on any platform keyed by address. */
export function handleKey(handle: string): string {
  const address = stripServiceSuffix(handle);
  if (address.includes("@")) return `dm:${address.toLowerCase()}`;
  const phone = address.replace(/\D/g, "").length > 8 && isValidPhoneNumber(address, "US")
    ? normalizePhone(address)
    : "";
  return `dm:${phone || address.toLowerCase()}`;
}

/** iMessage's chat GUID, `<service>;<+|->;<identifier>`. Nothing else in Convex or the bridge parses one. */
export const imessage = {
  platform: "imessage" as const satisfies CommaPlatform,

  /** `iMessage`, `SMS` or `RCS`. */
  service(chatGuid: string): string {
    return chatGuid.split(";")[0] ?? "";
  },

  /** The service a send through this chat shows. RCS counts as SMS, as BlueBubbles reports RCS messages. */
  sendService(chatGuid: string): "iMessage" | "SMS" {
    const service = imessage.service(chatGuid);
    return service === "SMS" || service === "RCS" ? "SMS" : "iMessage";
  },

  /** Service siblings (the iMessage, SMS and RCS chats with one person, or one group) share a key. */
  conversationKey(input: { isGroup: boolean; primaryChatGuid: string; participants: Participant[] }): string {
    if (!input.isGroup && input.participants.length === 1) return handleKey(input.participants[0].address);
    if (input.isGroup) {
      const identifier = input.primaryChatGuid.match(/^[^;]+;[+-];(.+)$/)?.[1];
      if (identifier) return `g:${identifier}`;
    }
    return `chat:${input.primaryChatGuid}`;
  },
};

const SERVICE_RANK: Record<string, number> = { iMessage: 0, RCS: 1, SMS: 2 };

/** The chat a conversation sends through: newest activity wins; ties prefer iMessage, then RCS, then SMS, then guid order. */
export function choosePrimary(chats: { chatGuid: string; lastMessageAt: number }[]): string {
  const ranked = [...chats].sort(
    (a, b) =>
      b.lastMessageAt - a.lastMessageAt ||
      (SERVICE_RANK[imessage.service(a.chatGuid)] ?? 9) - (SERVICE_RANK[imessage.service(b.chatGuid)] ?? 9) ||
      a.chatGuid.localeCompare(b.chatGuid),
  );
  const first = ranked[0];
  if (!first) throw new Error("conversation has no chats");
  return first.chatGuid;
}

/** The route a conversation's commands take: its primary chat. */
export function sendRoute(conversation: { primaryChatGuid: string }): CommaRoute {
  return { platform: "imessage", chatGuid: conversation.primaryChatGuid };
}

/** A route through the service asked for: the primary chat if it carries it, else the best sibling that does. */
export function routeFor(
  conversation: { primaryChatGuid: string; chatGuids: string[] },
  service?: "iMessage" | "SMS",
): CommaRoute | null {
  const carries = (chatGuid: string) => !service || imessage.sendService(chatGuid) === service;
  if (carries(conversation.primaryChatGuid)) return sendRoute(conversation);
  const candidates = conversation.chatGuids.filter(carries);
  if (!candidates.length) return null;
  return { platform: "imessage", chatGuid: choosePrimary(candidates.map((chatGuid) => ({ chatGuid, lastMessageAt: 0 }))) };
}
