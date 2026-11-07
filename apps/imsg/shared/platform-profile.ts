import type { TapbackType } from "./types";

/**
 * What a conversation's route can do, as data. Convex rejects a command its route's profile does not
 * support, and the client greys the control with the same reason. iMessage is the only platform; its
 * routes differ by service, so each feature lists the services that carry it.
 */

/** The service a route runs on. RCS is kept apart from SMS here, though both draw green. */
export type RouteService = "iMessage" | "SMS" | "RCS";

export interface ProfileRoute {
  platform: "imessage";
  service: RouteService;
  isGroup: boolean;
}

export type Feature =
  | "react" | "reply" | "edit" | "unsend" | "deleteMessage" | "typing" | "mentions"
  | "schedule" | "faceTimeLink" | "attachments" | "voiceMemo" | "contactCard"
  | "rename" | "participants" | "leaveGroup" | "deleteChat";

interface FeatureRule {
  services: readonly RouteService[];
  /** Exists only in a group. In a one-to-one conversation the control is absent, not greyed. */
  groupOnly?: true;
  /** BlueBubbles runs it only through its Private API. */
  privateApi?: true;
  /** Completes "<service> can't …". */
  cant: string;
}

const EVERY: readonly RouteService[] = ["iMessage", "SMS", "RCS"];
const IMESSAGE: readonly RouteService[] = ["iMessage"];

export const IMESSAGE_PROFILE = {
  /** The tapbacks a react command may send where "react" is supported. */
  reactions: ["love", "like", "dislike", "laugh", "emphasize", "question"] as const satisfies readonly TapbackType[],
  features: {
    react: { services: IMESSAGE, privateApi: true, cant: "send reactions" },
    reply: { services: IMESSAGE, privateApi: true, cant: "reply to a message" },
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

export const PROFILES = { imessage: IMESSAGE_PROFILE } satisfies Record<ProfileRoute["platform"], unknown>;

export type Support = { ok: true } | { ok: false; reason: string };

const OK: Support = { ok: true };

/** A chat GUID's service prefix as a route service. An unknown prefix sends as iMessage. */
export function routeService(prefix: string): RouteService {
  return prefix === "SMS" || prefix === "RCS" ? prefix : "iMessage";
}

/**
 * Whether the route can do `feature`, and if not, the reason to show. Null when the feature does not exist
 * in this conversation at all. `privateApi` is the Mac's live state; Convex leaves it out and lets the bridge fail.
 */
export function support(route: ProfileRoute, feature: Feature, bridge: { privateApi: boolean } = { privateApi: true }): Support | null {
  const rule: FeatureRule = PROFILES[route.platform].features[feature];
  if (rule.groupOnly && !route.isGroup) return null;
  if (!rule.services.includes(route.service)) return { ok: false, reason: `${route.service} can't ${rule.cant}` };
  if (rule.privateApi && !bridge.privateApi) return { ok: false, reason: "Needs the Mac's Private API" };
  return OK;
}

/** Support for sending this tapback, which also needs it in the platform's reaction set. */
export function reactionSupport(route: ProfileRoute, reaction: string, bridge?: { privateApi: boolean }): Support {
  const react = support(route, "react", bridge) ?? { ok: false, reason: "Reactions aren't available here" };
  if (!react.ok) return react;
  return (PROFILES[route.platform].reactions as readonly string[]).includes(reaction)
    ? OK
    : { ok: false, reason: `${route.service} can't send that reaction` };
}
