import { internalMutation } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

/**
 * Triggers metadata extraction after sync operations.
 * This should be called after any sync that might have updated tasks.
 */
export const triggerMetadataExtraction = internalMutation({
  handler: async (ctx) => {
    // Schedule the extraction to run asynchronously
    await ctx.scheduler.runAfter(0, internal.todoist.mutations.extractProjectMetadata, {});
    
    return { scheduled: true };
  },
});