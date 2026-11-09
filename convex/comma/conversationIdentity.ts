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

  /** BlueBubbles marks Milad's own messages, so a self handle never decides from-me. */
  reportsFromMe: true,

  /** BlueBubbles reports only whether a chat is a group. */
  kind: (input: { isGroup: boolean }): CommaConversationKind => (input.isGroup ? "group" : "dm"),

  /** Service siblings (the iMessage, SMS and RCS chats with one person, or one group) share a key. */
  conversationKey(input: { isGroup: boolean; primaryChatGuid?: string; participants: Participant[] }): string {
    if (!input.isGroup && input.participants.length === 1) return handleKey(input.participants[0].address);
    const chatGuid = primaryChat(input);
    if (input.isGroup) {
      const identifier = chatGuid.match(/^[^;]+;[+-];(.+)$/)?.[1];
      if (identifier) return `g:${identifier}`;
    }
    return `chat:${chatGuid}`;
  },
};

/**
 * What ingest asks every platform. How a platform keys and kinds its conversations is its own ingest's: only
 * iMessage merges several chats into one conversation, so its chat GUID rules stay on `imessage`.
 */
export interface PlatformIdentity {
  platform: CommaPlatform;
  /** The platform marks its own messages from-me. Where it does not, a sender among the account's selfHandles is me. */
  reportsFromMe: boolean;
}

/** A Slack conversation as Slack names it: a DM, a group DM, a channel, or a thread inside any of them. */
export type SlackConversationRef =
  | { type: "im" | "mpim" | "channel"; channel: string }
  | { type: "thread"; channel: string; threadTs: string };

/** The Slack workspace Milad reads as himself. A message id is `<channel>:<ts>`, unique within the workspace. */
export const slack = {
  platform: "slack" as const satisfies CommaPlatform,

  /** Slack never says a message is from the token's user; a sender equal to the account's `slack:` self handle is. */
  reportsFromMe: false,

  kind(ref: SlackConversationRef): CommaConversationKind {
    if (ref.type === "im") return "dm";
    return ref.type === "channel" || ref.type === "thread" ? ref.type : "group";
  },

  /** The keys of the conversation a thread belongs to, one per kind it can be: a DM, a group DM or a channel. */
  parentKeys: (channel: string): string[] => [`im:${channel}`, `mpim:${channel}`, `ch:${channel}`],

  /** `im:D…`, `mpim:G…`, `ch:C…`, or `th:C…:<root ts>`. */
  conversationKey(ref: SlackConversationRef): string {
    return ref.type === "thread" ? `th:${ref.channel}:${ref.threadTs}` : `${ref.type === "channel" ? "ch" : ref.type}:${ref.channel}`;
  },

  messageGuid: (channel: string, ts: string): string => `${channel}:${ts}`,
};

/** A Gmail mailbox. A conversation is one Gmail thread; a message id is Gmail's, unique within the mailbox. */
export const gmail = {
  platform: "gmail" as const satisfies CommaPlatform,

  /** Gmail marks sent mail with the SENT label, but a message is from me when its From is one of the account's addresses. */
  reportsFromMe: false,

  kind: (): CommaConversationKind => "emailThread",

  conversationKey: (threadId: string): string => `t:${threadId}`,
};

export const PLATFORM_IDENTITY = { imessage, slack, gmail } satisfies Record<CommaPlatform, PlatformIdentity>;

/**
 * A stored conversation's kind. Rows from before kinds read theirs off `isGroup` until the kinds backfill stamps them,
 * and Slack threads stored as groups before S3 read as threads until the threads backfill restamps them.
 */
export function conversationKind(conversation: {
  kind?: CommaConversationKind; isGroup: boolean; slack?: { threadTs?: string };
}): CommaConversationKind {
  if (conversation.slack?.threadTs) return "thread";
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

type Routable = {
  platform?: CommaPlatform; primaryChatGuid?: string; accountId?: CommaRoute["accountId"];
  slack?: { channel: string; threadTs?: string };
  gmail?: { threadId: string };
};

/** An iMessage conversation's primary chat. Only iMessage conversations have chats. */
export function primaryChat(conversation: { primaryChatGuid?: string }): string {
  if (!conversation.primaryChatGuid) throw new Error("Conversation has no iMessage chat");
  return conversation.primaryChatGuid;
}

function routeThrough(conversation: Routable, chatGuid: string): CommaRoute {
  return { platform: "imessage", ...(conversation.accountId ? { accountId: conversation.accountId } : {}), chatGuid };
}

/** The route a conversation's commands take: iMessage's account and primary chat, Slack's channel and thread, or Gmail's thread. */
export function sendRoute(conversation: Routable): CommaRoute {
  if (conversation.platform === "gmail") {
    if (!conversation.gmail || !conversation.accountId) throw new Error("Gmail conversation has no thread");
    return { platform: "gmail", accountId: conversation.accountId, threadId: conversation.gmail.threadId };
  }
  if (conversation.platform !== "slack") return routeThrough(conversation, primaryChat(conversation));
  if (!conversation.slack || !conversation.accountId) throw new Error("Slack conversation has no channel");
  // Pick the route's fields: a thread's `slack` also carries `following`, which the route validator rejects.
  const { channel, threadTs } = conversation.slack;
  return { platform: "slack", accountId: conversation.accountId, channel, ...(threadTs ? { threadTs } : {}) };
}

/** A route through the service asked for: the primary chat if it carries it, else the best sibling that does. */
export function routeFor(
  conversation: Routable & { chatGuids?: string[] },
  service?: "iMessage" | "SMS",
): CommaRoute | null {
  if (conversation.platform === "slack" || conversation.platform === "gmail") return service ? null : sendRoute(conversation);
  const carries = (chatGuid: string) => !service || imessage.sendService(chatGuid) === service;
  if (carries(primaryChat(conversation))) return sendRoute(conversation);
  const candidates = (conversation.chatGuids ?? []).filter(carries);
  if (!candidates.length) return null;
  return routeThrough(conversation, choosePrimary(candidates.map((chatGuid) => ({ chatGuid, lastMessageAt: 0 }))));
}
