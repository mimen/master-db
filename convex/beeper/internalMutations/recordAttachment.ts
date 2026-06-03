import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

/**
 * Register a uniquely-identified media file after its bytes have been
 * uploaded to Convex File Storage by the local uploader script.
 *
 * Idempotent: if a row already exists for this mxc_id we DELETE the
 * newly-uploaded storage object (the caller's upload) before patching the
 * row, so duplicates don't accumulate in storage. The pre-existing
 * convex_storage_id is what stays referenced.
 */
export const recordAttachment = internalMutation({
  args: {
    mxc_id: v.string(),
    convex_storage_id: v.string(),
    network: v.string(),
    mime_type: v.optional(v.string()),
    file_name: v.optional(v.string()),
    file_size: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    duration_ms: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("beeper_attachments")
      .withIndex("by_mxc_id", (q) => q.eq("mxc_id", args.mxc_id))
      .first();

    if (existing) {
      // Lost the race — somebody else already uploaded this mxc_id. Free our
      // duplicate so we don't leak storage bytes.
      if (existing.convex_storage_id !== args.convex_storage_id) {
        await ctx.storage.delete(args.convex_storage_id);
      }
      return existing._id;
    }

    return await ctx.db.insert("beeper_attachments", {
      mxc_id: args.mxc_id,
      convex_storage_id: args.convex_storage_id,
      network: args.network,
      mime_type: args.mime_type,
      file_name: args.file_name,
      file_size: args.file_size,
      width: args.width,
      height: args.height,
      duration_ms: args.duration_ms,
      uploaded_at: new Date().toISOString(),
    });
  },
});
