import type { ConversationKind, Platform, TapbackType } from "./types";

/**
 * What a conversation's route can do, as data. Convex rejects a command its route's profile does not
 * support, and the client greys the control with the same reason. iMessage is the only platform; its
 * routes differ by service, so each feature lists the services that carry it.
 */

/** The service a route runs on. RCS is kept apart from SMS here, though both draw green. */
export type RouteService = "iMessage" | "SMS" | "RCS";

export interface ProfileRoute {
  platform: Platform;
  service: RouteService;
  isGroup: boolean;
}

export type Feature =
  | "react" | "emojiReact" | "reply" | "edit" | "unsend" | "deleteMessage" | "typing" | "mentions"
  | "schedule" | "call" | "faceTimeLink" | "attachments" | "voiceMemo" | "contactCard"
  | "rename" | "participants" | "leaveGroup" | "deleteChat";

/** How a route draws beside a name: its label and the theme colour of its dot. */
export interface PlatformBadge {
  readonly label: string;
  readonly color: "accent" | "sms" | "icon";
}

/** A handle no route reaches, such as an Instagram username. */
export const UNREACHED_BADGE: PlatformBadge = { label: "Other", color: "icon" };

interface FeatureRule {
  services: readonly RouteService[];
  /** Exists only in a group. In a one-to-one conversation the control is absent, not greyed. */
  groupOnly?: true;
  /** BlueBubbles runs it only through its Private API. */
  privateApi?: true;
  /** The Mac must also advertise this, beyond the Private API. */
  needs?: "emojiReactions";
  /** Completes "<service> can't …". */
  cant: string;
}

/** What a conversation wants from the user, read off its last message: a reply, their reply, or nothing. */
export type Attention = "needsYou" | "waiting" | "none";

/** Where a conversation sits against the screening boundary of the type lens and Today. */
export type Screening = "known" | "stranger" | "spam";

/** The rules core logic asks a platform, beyond what its routes can do. */
export interface PlatformRules {
  /** The platform marks its own messages from-me. Where it does not, a sender among the account's selfHandles is me. */
  reportsFromMe: boolean;
  attention(conversation: { kind: ConversationKind }, last: { isFromMe: boolean } | null): Attention;
  screening(conversation: { isSpam: boolean; known: boolean }): Screening;
}

const EVERY: readonly RouteService[] = ["iMessage", "SMS", "RCS"];
const IMESSAGE: readonly RouteService[] = ["iMessage"];
/** Messages sends tapbacks and threaded replies over RCS; chat.db holds both from Milad's RCS chats. */
const NOT_SMS: readonly RouteService[] = ["iMessage", "RCS"];

const IMESSAGE_BADGE: PlatformBadge = { label: "iMessage", color: "accent" };
// RCS draws as SMS: BlueBubbles reports its messages as SMS.
const SMS_BADGE: PlatformBadge = { label: "SMS", color: "sms" };

export const IMESSAGE_PROFILE = {
  name: "iMessage",
  badges: { iMessage: IMESSAGE_BADGE, SMS: SMS_BADGE, RCS: SMS_BADGE } satisfies Record<RouteService, PlatformBadge>,
  /** How long after sending a message the platform still edits or unsends it. */
  editWindowMs: 15 * 60_000,
  unsendWindowMs: 2 * 60_000,
  composer: {
    placeholder: { iMessage: "iMessage", SMS: "Text Message", RCS: "Text Message" } satisfies Record<RouteService, string>,
    /** On desktop, Enter sends and Shift+Enter starts a new line. */
    enterSends: true,
    /** What the "Send with" menu lists. Only the conversation's own service can be picked: the outbox has no per-message service. */
    services: ["iMessage", "SMS"] satisfies RouteService[],
  },
  reportsFromMe: true,
  /** Every inbound last message is owed a reply, and every outbound one waits on theirs, in a dm or a group alike. */
  attention: (_conversation: { kind: ConversationKind }, last: { isFromMe: boolean } | null): Attention =>
    last === null ? "none" : last.isFromMe ? "waiting" : "needsYou",
  /** Apple's junk flag screens; otherwise a participant who resolves to a named person makes the conversation known. */
  screening: (conversation: { isSpam: boolean; known: boolean }): Screening =>
    conversation.isSpam ? "spam" : conversation.known ? "known" : "stranger",
  /** The tapbacks a react command may send where "react" is supported. */
  reactions: ["love", "like", "dislike", "laugh", "emphasize", "question"] as const satisfies readonly TapbackType[],
  features: {
    react: { services: NOT_SMS, privateApi: true, cant: "send reactions" },
    // chat.db holds emoji tapbacks sent over RCS, Milad's own included. BlueBubbles 1.9.12 sends only the six named
    // ones; a server that can send emoji says so in server info (server#839/#870, which need macOS 26).
    emojiReact: { services: NOT_SMS, privateApi: true, needs: "emojiReactions", cant: "send emoji reactions" },
    reply: { services: NOT_SMS, privateApi: true, cant: "reply to a message" },
    edit: { services: IMESSAGE, privateApi: true, cant: "edit messages" },
    unsend: { services: IMESSAGE, privateApi: true, cant: "unsend messages" },
    deleteMessage: { services: EVERY, privateApi: true, cant: "delete messages" },
    typing: { services: IMESSAGE, privateApi: true, cant: "show typing" },
    mentions: { services: IMESSAGE, groupOnly: true, privateApi: true, cant: "mention people" },
    schedule: { services: EVERY, cant: "schedule messages" },
    // A call opens FaceTime on this device, so it needs no Private API.
    call: { services: EVERY, cant: "call" },
    faceTimeLink: { services: EVERY, privateApi: true, cant: "send FaceTime links" },
    attachments: { services: EVERY, cant: "send attachments" },
    voiceMemo: { services: EVERY, cant: "send voice messages" },
    contactCard: { services: EVERY, cant: "send contact cards" },
    rename: { services: IMESSAGE, groupOnly: true, privateApi: true, cant: "name a group" },
    participants: { services: IMESSAGE, groupOnly: true, privateApi: true, cant: "add or remove people" },
    leaveGroup: { services: IMESSAGE, groupOnly: true, privateApi: true, cant: "leave a group" },
    deleteChat: { services: EVERY, privateApi: true, cant: "delete conversations" },
  } satisfies Record<Feature, FeatureRule>,
};

/** How each named tapback looks, for readers on any platform. */
export const TAPBACK_GLYPHS: Readonly<Record<TapbackType, string>> = {
  love: "❤️", like: "👍", dislike: "👎", laugh: "😂", emphasize: "‼️", question: "❓",
};

/**
 * A reaction's key: a named tapback's name, or `emoji:` and the emoji for an emoji tapback ("emoji" alone when
 * the emoji could not be read). A sender keeps one reaction per message, whatever its key.
 */
export function tapbackKey(type: string, emoji?: string): string {
  return type === "emoji" ? (emoji ? `emoji:${emoji}` : "emoji") : type;
}

export function isEmojiKey(key: string): boolean {
  return key === "emoji" || key.startsWith("emoji:");
}

/** The emoji an `emoji:` key carries, or null for any other key. */
export function keyEmoji(key: string): string | null {
  return key.startsWith("emoji:") ? key.slice("emoji:".length) || null : null;
}

export const PROFILES = { imessage: IMESSAGE_PROFILE } satisfies Record<Platform, PlatformRules>;

/** What the conversation's platform says it wants from the user. */
export function attentionOf(conversation: { platform: Platform; kind: ConversationKind }, last: { isFromMe: boolean } | null): Attention {
  return PROFILES[conversation.platform].attention(conversation, last);
}

/** The conversation's platform's screening verdict. */
export function screeningOf(conversation: { platform: Platform; isSpam: boolean; known: boolean }): Screening {
  return PROFILES[conversation.platform].screening(conversation);
}

export type Support = { ok: true } | { ok: false; reason: string };

const OK: Support = { ok: true };

/** A chat GUID's service prefix as a route service. An unknown prefix sends as iMessage. */
export function routeService(prefix: string): RouteService {
  return prefix === "SMS" || prefix === "RCS" ? prefix : "iMessage";
}

/** The service a message sent through the route draws as: RCS draws green, as BlueBubbles reports its messages as SMS. */
export function messageService(service: RouteService): "iMessage" | "SMS" {
  return service === "iMessage" ? "iMessage" : "SMS";
}

export function platformBadge(route: Pick<ProfileRoute, "platform" | "service">): PlatformBadge {
  return PROFILES[route.platform].badges[route.service];
}

/** The badge of every service a platform sends on, once each, in profile order. */
export function platformServiceBadges(platform: Platform): PlatformBadge[] {
  return [...new Set(Object.values(PROFILES[platform].badges))];
}

export interface ComposerConfig {
  readonly placeholder: string;
  readonly badge: PlatformBadge;
  readonly enterSends: boolean;
  /** The "Send with" menu: the route's own service first, then the rest, which can't be picked yet. */
  readonly serviceOptions: readonly PlatformBadge[];
  readonly editWindowMs: number;
}

export function composerConfig(route: Pick<ProfileRoute, "platform" | "service">): ComposerConfig {
  const profile = PROFILES[route.platform];
  const badge = platformBadge(route);
  const others = profile.composer.services.map((service) => profile.badges[service]).filter((option) => option !== badge);
  return {
    placeholder: profile.composer.placeholder[route.service],
    badge,
    enterSends: profile.composer.enterSends,
    serviceOptions: [badge, ...others],
    editWindowMs: profile.editWindowMs,
  };
}

/** What the Mac can do right now, from its bridge state. */
export interface BridgeSupport {
  privateApi: boolean;
  emojiReactions?: boolean;
}

/**
 * Whether the route can do `feature`, and if not, the reason to show. Null when the feature does not exist
 * in this conversation at all. `bridge` is the Mac's live state; Convex leaves it out and lets the bridge fail.
 */
export function support(route: ProfileRoute, feature: Feature, bridge: BridgeSupport = { privateApi: true, emojiReactions: true }): Support | null {
  const rule: FeatureRule = PROFILES[route.platform].features[feature];
  if (rule.groupOnly && !route.isGroup) return null;
  if (!rule.services.includes(route.service)) return { ok: false, reason: `${route.service} can't ${rule.cant}` };
  if (rule.privateApi && !bridge.privateApi) return { ok: false, reason: "Needs the Mac's Private API" };
  if (rule.needs === "emojiReactions" && !bridge.emojiReactions) return { ok: false, reason: "The Mac's BlueBubbles can't send emoji reactions yet" };
  return OK;
}

/** Support for sending this reaction: an emoji key needs "emojiReact", a named tapback the platform's reaction set. */
export function reactionSupport(route: ProfileRoute, reaction: string, bridge?: BridgeSupport): Support {
  const react = support(route, isEmojiKey(reaction) ? "emojiReact" : "react", bridge) ?? { ok: false, reason: "Reactions aren't available here" };
  if (!react.ok) return react;
  return keyEmoji(reaction) !== null || (PROFILES[route.platform].reactions as readonly string[]).includes(reaction)
    ? OK
    : { ok: false, reason: `${route.service} can't send that reaction` };
}
