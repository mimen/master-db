import { isValidPhoneNumber } from "libphonenumber-js";

import { normalizePhone, parseHandle, stripServiceSuffix } from "../../apps/imsg/shared/address";
import type { Participant } from "../../apps/imsg/shared/types";
import type { CommaConversationKind, CommaPlatform, CommaRoute } from "../schema/comma/validators";

/**
 * What makes two platform threads one Comma conversation, and which thread a command goes through.
 * A conversation is identified by (platform, conversationKey); the app and core logic use only its
 * Convex id. This file is pure so the Mini's bridge groups chats with the same rules Convex keys
 * them by. Convex's reads live in conversationLookup.ts.
 */

/** The key a one-to-one conversation with this handle has, on any platform keyed by address. */
export function handleKey(raw: string): string {
  const handle = parseHandle(raw);
  const address = handle?.address ?? stripServiceSuffix(raw);
  // Stored keys predate handle kinds: only a phone libphonenumber accepts is keyed by E.164; the rest lowercase.
  const phone = handle?.kind === "phone" && address.replace(/\D/g, "").length > 8 && isValidPhoneNumber(address, "US")
    ? normalizePhone(address)
    : "";
  return `dm:${phone || address.toLowerCase()}`;
}

/** The iMessage account: the Mac whose Messages the Mini's bridge mirrors. Its bridge names it at startup. */
export const IMESSAGE_ACCOUNT = { platform: "imessage", externalId: "mini", label: "iMessage" } as const satisfies { platform: CommaPlatform; externalId: string; label: string };

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

  /** Newest activity wins; ties prefer iMessage, then RCS, then SMS. */
  choosePrimary: (chats: { chatGuid: string; lastMessageAt: number }[]) => choosePrimary(chats),

  /** BlueBubbles reports only whether a chat is a group. */
  kind: (input: { isGroup: boolean }): CommaConversationKind => (input.isGroup ? "group" : "dm"),

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

/** What ingest asks a platform when it mirrors a conversation: its key, its primary thread, and an alias's service. */
export interface PlatformIdentity {
  platform: CommaPlatform;
  kind(input: { isGroup: boolean }): CommaConversationKind;
  conversationKey(input: { isGroup: boolean; primaryChatGuid: string; participants: Participant[] }): string;
  choosePrimary(chats: { chatGuid: string; lastMessageAt: number }[]): string;
  service(chatGuid: string): string;
}

export const PLATFORM_IDENTITY = { imessage } satisfies Record<CommaPlatform, PlatformIdentity>;

/** A stored conversation's kind; rows from before kinds read theirs off `isGroup` until the kinds backfill stamps them. */
export function conversationKind(conversation: { kind?: CommaConversationKind; isGroup: boolean }): CommaConversationKind {
  return conversation.kind ?? (conversation.isGroup ? "group" : "dm");
}

/** `isGroup` as kinds define it: every kind but a dm has more than one other side. */
export function isGroupKind(kind: CommaConversationKind): boolean {
  return kind !== "dm";
}

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

type Routable = { primaryChatGuid: string; accountId?: CommaRoute["accountId"] };

function routeThrough(conversation: Routable, chatGuid: string): CommaRoute {
  return { platform: "imessage", ...(conversation.accountId ? { accountId: conversation.accountId } : {}), chatGuid };
}

/** The route a conversation's commands take: its account and primary chat. */
export function sendRoute(conversation: Routable): CommaRoute {
  return routeThrough(conversation, conversation.primaryChatGuid);
}

/** A route through the service asked for: the primary chat if it carries it, else the best sibling that does. */
export function routeFor(
  conversation: Routable & { chatGuids: string[] },
  service?: "iMessage" | "SMS",
): CommaRoute | null {
  const carries = (chatGuid: string) => !service || imessage.sendService(chatGuid) === service;
  if (carries(conversation.primaryChatGuid)) return sendRoute(conversation);
  const candidates = conversation.chatGuids.filter(carries);
  if (!candidates.length) return null;
  return routeThrough(conversation, choosePrimary(candidates.map((chatGuid) => ({ chatGuid, lastMessageAt: 0 }))));
}
