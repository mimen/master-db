import { v } from "convex/values";

import { mutation } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";

export const generateAttachmentUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await assertAllowed(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const finalizeUpload = mutation({
  args: { storageId: v.id("_storage"), filename: v.string(), mimeType: v.string() },
  returns: v.id("comma_uploads"),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    if (!args.filename.trim() || !args.mimeType.trim()) throw new Error("Filename and MIME type are required");
    const stored = await ctx.db.system.get(args.storageId);
    if (!stored) throw new Error("Uploaded file not found");
    if (stored.contentType && stored.contentType !== args.mimeType) throw new Error("Uploaded MIME type does not match");
    if (stored.size === 0) throw new Error("Uploaded file is empty");
    const existing = await ctx.db.query("comma_uploads").withIndex("by_storageId", (q) => q.eq("storageId", args.storageId)).unique();
    if (existing) {
      if (existing.filename !== args.filename || existing.mimeType !== args.mimeType) throw new Error("Upload metadata does not match");
      return existing._id;
    }
    return ctx.db.insert("comma_uploads", { ...args, totalBytes: stored.size, createdAt: Date.now() });
  },
});
