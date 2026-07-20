import { internal } from "../../_generated/api";
import { httpAction } from "../../_generated/server";

import { checkBeeperIngestAuth, jsonResponse } from "./auth";

/**
 * POST /beeper/attachments/discover
 *
 * Body: { mxc_ids: string[] }
 * Returns: { ok: true, uploaded: {mxc_id, convex_storage_id}[], missing: string[] }
 *
 * Called by the local uploader at the start of every run (and per batch) to
 * skip files we've already uploaded — making re-runs effectively free.
 */
export const handleDiscover = httpAction(async (ctx, req) => {
  const authErr = checkBeeperIngestAuth(req);
  if (authErr) return authErr;

  let body: { mxc_ids?: unknown };
  try {
    body = (await req.json()) as { mxc_ids?: unknown };
  } catch {
    return jsonResponse({ ok: false, error: "invalid JSON" }, 400);
  }
  if (!Array.isArray(body.mxc_ids) || !body.mxc_ids.every((x) => typeof x === "string")) {
    return jsonResponse({ ok: false, error: "mxc_ids must be string[]" }, 400);
  }

  const result = await ctx.runQuery(
    internal.beeper.queries.discoverAttachments.discoverAttachments,
    { mxc_ids: body.mxc_ids as string[] },
  );
  return jsonResponse({ ok: true, ...result });
});

/**
 * POST /beeper/attachments/uploadUrl
 *
 * Body: {}
 * Returns: { ok: true, uploadUrl: string }
 *
 * The uploader PUTs the file bytes to that URL; Convex responds with
 * { storageId: string } which the uploader passes to /record.
 */
export const handleUploadUrl = httpAction(async (ctx, req) => {
  const authErr = checkBeeperIngestAuth(req);
  if (authErr) return authErr;

  const uploadUrl = await ctx.runMutation(
    internal.beeper.internalMutations.generateUploadUrl.generateUploadUrl,
  );
  return jsonResponse({ ok: true, uploadUrl });
});

/**
 * POST /beeper/attachments/record
 *
 * Body: { mxc_id, convex_storage_id, network, mime_type?, file_name?,
 *         file_size?, width?, height?, duration_ms? }
 * Returns: { ok: true }
 *
 * Idempotent: a race where two uploaders write the same mxc_id results in
 * the second-arriver's storage object being deleted by the mutation.
 */
export const handleRecord = httpAction(async (ctx, req) => {
  const authErr = checkBeeperIngestAuth(req);
  if (authErr) return authErr;

  let body: AttachmentRecordIn;
  try {
    body = (await req.json()) as AttachmentRecordIn;
  } catch {
    return jsonResponse({ ok: false, error: "invalid JSON" }, 400);
  }
  if (typeof body.mxc_id !== "string" || typeof body.convex_storage_id !== "string") {
    return jsonResponse({ ok: false, error: "mxc_id and convex_storage_id required" }, 400);
  }

  await ctx.runMutation(
    internal.beeper.internalMutations.recordAttachment.recordAttachment,
    body,
  );
  return jsonResponse({ ok: true });
});

type AttachmentRecordIn = {
  mxc_id: string;
  convex_storage_id: string;
  network: string;
  mime_type?: string;
  file_name?: string;
  file_size?: number;
  width?: number;
  height?: number;
  duration_ms?: number;
};
