import type { Platform, TapbackType } from "./types";

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
  | "schedule" | "faceTimeLink" | "attachments" | "voiceMemo" | "contactCard"
  | "rename" | "participants" | "leaveGroup" | "deleteChat";

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

const EVERY: readonly RouteService[] = ["iMessage", "SMS", "RCS"];
const IMESSAGE: readonly RouteService[] = ["iMessage"];
/** Messages sends tapbacks and threaded replies over RCS; chat.db holds both from Milad's RCS chats. */
const NOT_SMS: readonly RouteService[] = ["iMessage", "RCS"];

export const IMESSAGE_PROFILE = {
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

export const PROFILES = { imessage: IMESSAGE_PROFILE } satisfies Record<Platform, unknown>;

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
