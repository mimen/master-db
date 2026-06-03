import { internalMutation } from "../../_generated/server";

/**
 * Issue a short-lived upload URL that the local uploader script POSTs file
 * bytes to. The returned URL is single-use and Convex auto-expires it; we
 * never persist it.
 */
export const generateUploadUrl = internalMutation({
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});
