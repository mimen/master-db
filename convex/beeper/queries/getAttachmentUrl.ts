import { v } from "convex/values";

import { query } from "../../_generated/server";

/**
 * Resolve an mxc_id to a short-lived Convex File Storage URL. Returns null
 * when the file hasn't been uploaded yet (Phase B not run for it, or the
 * attachment never made it into the dedupe table).
 *
 * URLs returned by `ctx.storage.getUrl` expire after a short window; callers
 * should re-fetch on each render rather than persist the URL.
 */
export const getAttachmentUrl = query({
  args: { mxc_id: v.string() },
  handler: async (ctx, { mxc_id }) => {
    const row = await ctx.db
      .query("beeper_attachments")
      .withIndex("by_mxc_id", (q) => q.eq("mxc_id", mxc_id))
      .first();
    if (!row) return null;
    const url = await ctx.storage.getUrl(row.convex_storage_id);
    return {
      mxc_id: row.mxc_id,
      convex_storage_id: row.convex_storage_id,
      url,
      mime_type: row.mime_type,
      file_name: row.file_name,
      file_size: row.file_size,
    };
  },
});
