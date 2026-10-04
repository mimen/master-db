import { internal } from "../_generated/api";
import { httpAction, internalMutation } from "../_generated/server";
import { jsonResponse } from "../beeper/sync/auth";

import { checkBridgeAuth } from "./bridgeAuth";

/**
 * POST /comma/ingest/<kind>. Bearer COMMA_BRIDGE_SECRET. The body is exactly
 * the args object of the matching internal mutation in ./internal.ts; the
 * mutation's validators reject anything malformed, so this layer only
 * authenticates and routes. See apps/imsg/docs/convex-ingest-contract.md.
 */
const ROUTES = {
  conversations: internal.comma.internal.upsertConversations,
  deleteChat: (internal.comma as typeof internal.comma & { deletions: { deleteChat: import("convex/server").FunctionReference<"mutation", "internal"> } }).deletions.deleteChat,
  messages: internal.comma.internal.upsertMessages,
  attachments: internal.comma.internal.upsertAttachments,
  transcript: internal.comma.internal.setTranscript,
  storage: internal.comma.internal.setAttachmentStorage,
  photo: internal.comma.photos.setContactPhoto,
  mediaBacklog: internal.comma.internal.mediaBacklog,
  scheduled: internal.comma.internal.replaceScheduled,
  overlay: internal.comma.internal.importOverlay,
  sync: internal.comma.internal.markSyncState,
  suggestions: internal.comma.internal.setSuggestions,
  claim: internal.comma.outbox.claimOutbox,
  complete: internal.comma.outbox.completeOutbox,
  renew: internal.comma.outbox.renewOutbox,
} as const;

export type IngestKind = keyof typeof ROUTES;

export function ingestKind(pathname: string): IngestKind | null {
  const kind = pathname.replace(/^\/comma\/ingest\//, "");
  return Object.prototype.hasOwnProperty.call(ROUTES, kind) ? (kind as IngestKind) : null;
}

export const handleIngest = httpAction(async (ctx, request) => {
  const denied = checkBridgeAuth(request);
  if (denied) return denied;
  const kind = ingestKind(new URL(request.url).pathname);
  if (!kind) return jsonResponse({ ok: false, error: "unknown ingest kind" }, 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid JSON" }, 400);
  }
  try {
    // The mutation's arg validator is the schema check for `body`.
    const result: unknown = await ctx.runMutation(ROUTES[kind], body as never);
    return jsonResponse({ ok: true, result }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ ok: false, error: message }, 400);
  }
});

export const generateUploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/** POST /comma/ingest-upload-url: a single-use URL the bridge uploads a thumbnail or original to. */
export const handleUploadUrl = httpAction(async (ctx, request) => {
  const denied = checkBridgeAuth(request);
  if (denied) return denied;
  const url: string = await ctx.runMutation(internal.comma.ingest.generateUploadUrl, {});
  return jsonResponse({ ok: true, url }, 200);
});
