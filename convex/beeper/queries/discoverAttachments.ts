import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

/**
 * Given a batch of mxc_ids, return which ones are already in Convex File
 * Storage (so the local uploader can skip them) and which ones still need
 * uploading.
 *
 * The uploader calls this in 200-id chunks at the start of every run; the
 * skipped set typically grows to 100% on a resumed run, making re-runs
 * basically free.
 */
export const discoverAttachments = internalQuery({
  args: {
    mxc_ids: v.array(v.string()),
  },
  handler: async (ctx, { mxc_ids }) => {
    const uploaded: { mxc_id: string; convex_storage_id: string }[] = [];
    const missing: string[] = [];

    for (const mxc_id of mxc_ids) {
      const row = await ctx.db
        .query("beeper_attachments")
        .withIndex("by_mxc_id", (q) => q.eq("mxc_id", mxc_id))
        .first();
      if (row) {
        uploaded.push({
          mxc_id: row.mxc_id,
          convex_storage_id: row.convex_storage_id,
        });
      } else {
        missing.push(mxc_id);
      }
    }

    return { uploaded, missing };
  },
});
