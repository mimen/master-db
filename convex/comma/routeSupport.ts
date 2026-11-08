import { reactionSupport, routeService, support, type Feature, type ProfileRoute, type Support } from "../../apps/imsg/shared/platform-profile";
import type { CommaOutboxPayload, CommaRoute, CoreMessagingKind, IMessageOnlyKind } from "../schema/comma/validators";

import { imessage } from "./conversationIdentity";

/**
 * Which commands a route can run, read from its platform profile. Pure, so the fixture's fake Convex rejects
 * exactly what Convex does. Model work and triage touch no route and always pass.
 */

/** The profile feature each platform command needs from its route. */
const ROUTE_FEATURE = {
  send: null, react: "react", edit: "edit", unsend: "unsend", delete: "deleteMessage", markRead: null, rename: "rename",
  schedule: "schedule", createChat: null, sendAttachment: "attachments", typing: "typing",
  editScheduled: "schedule", cancelScheduled: null, sendScheduledNow: null, sendContact: "contactCard",
  participant: "participants", leaveGroup: "leaveGroup", deleteChat: "deleteChat", createFaceTimeLink: "faceTimeLink",
} satisfies Record<CoreMessagingKind | IMessageOnlyKind, Feature | null>;

const routeFeature: Partial<Record<CommaOutboxPayload["kind"], Feature | null>> = ROUTE_FEATURE;

function neededFeatures(payload: CommaOutboxPayload): Feature[] {
  if (payload.kind === "send") return ["send", ...(payload.replyToGuid ? ["reply" as const] : []), ...(payload.mentions?.length ? ["mentions" as const] : [])];
  if (payload.kind === "sendAttachment") return [payload.isAudioMessage ? "voiceMemo" : "attachments"];
  // A reply nobody can send is not worth a model call.
  if (payload.kind === "suggestions") return ["send"];
  const feature = routeFeature[payload.kind];
  return feature ? [feature] : [];
}

/** A stamped route as its platform profile reads it. */
export function profileRoute(route: CommaRoute, isGroup: boolean): ProfileRoute {
  switch (route.platform) {
    case "imessage":
      return { platform: "imessage", service: routeService(imessage.service(route.chatGuid)), isGroup };
    case "slack":
      return { platform: "slack", service: "Slack", isGroup };
    case "gmail":
      return { platform: "gmail", service: "Gmail", isGroup };
  }
}

function routeSupport(route: CommaRoute, isGroup: boolean, payload: CommaOutboxPayload): Support | null {
  const profile = profileRoute(route, isGroup);
  if (payload.kind === "react") return reactionSupport(profile, payload.reaction);
  for (const feature of neededFeatures(payload)) {
    const result = support(profile, feature);
    if (!result?.ok) return result;
  }
  return { ok: true };
}

/** Why the route's profile can't run this command, or null when it can. Enqueue rejects with it. */
export function unsupportedReason(route: CommaRoute, isGroup: boolean, payload: CommaOutboxPayload): string | null {
  const supported = routeSupport(route, isGroup, payload);
  if (!supported) return "That only works in a group conversation";
  return supported.ok ? null : supported.reason;
}
