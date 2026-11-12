import { internal } from "../_generated/api";
import { httpAction, type ActionCtx } from "../_generated/server";
import { constantTimeEqual } from "../_lib/constantTimeEqual";
import { jsonResponse } from "../beeper/sync/auth";

function checkSavedIngestAuth(request: Request): Response | null {
  const expected = process.env.SAVED_INGEST_SECRET;
  if (!expected) {
    return jsonResponse({ ok: false, error: "SAVED_INGEST_SECRET is not configured" }, 500);
  }
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  return constantTimeEqual(expected, provided)
    ? null
    : jsonResponse({ ok: false, error: "unauthorized" }, 401);
}

/**
 * A bearer-authed POST route whose JSON object body becomes the args of one
 * internal function. That function's arg validator is the shape check, so its
 * rejection maps to 400.
 */
function savedRoute(
  run: (ctx: ActionCtx, body: never) => Promise<Record<string, unknown>>,
) {
  return httpAction(async (ctx, request) => {
    const denied = checkSavedIngestAuth(request);
    if (denied) return denied;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "invalid JSON" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return jsonResponse({ ok: false, error: "body must be a JSON object" }, 400);
    }
    try {
      return jsonResponse({ ok: true, ...(await run(ctx, body as never)) });
    } catch (error) {
      return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
}

/** POST /saved/ingest {items} -> {ok, inserted, updated} */
export const handleIngest = savedRoute((ctx, body) => ctx.runMutation(internal.saved.ingest.upsertItems, body));

/** POST /saved/known {platform, platform_ids} -> {ok, known} */
export const handleKnown = savedRoute(async (ctx, body) => ({
  known: await ctx.runQuery(internal.saved.ingest.knownIds, body),
}));

/** POST /saved/upload-url {} -> {ok, uploadUrl}. POST the bytes there to get {storageId}. */
export const handleUploadUrl = savedRoute(async (ctx) => ({
  uploadUrl: await ctx.runMutation(internal.saved.ingest.generateUploadUrl, {}),
}));

/** POST /saved/untriaged {limit?} -> {ok, items}, newest first, limit defaults to 50. */
export const handleUntriaged = savedRoute(async (ctx, body: { limit?: number }) => ({
  items: await ctx.runQuery(internal.saved.ingest.listUntriaged, { limit: 50, ...body }),
}));

/** POST /saved/triage {results} -> {ok, updated, skipped} */
export const handleTriage = savedRoute((ctx, body) => ctx.runMutation(internal.saved.ingest.setTriage, body));
