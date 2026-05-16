import { internal } from "../../_generated/api";
import { authedAction } from "../../_lib/authed";

export const clearAllData = authedAction({
  args: {},
  handler: async (ctx) => {
    console.warn("WARNING: Clearing all Todoist data from the database");

    // Clear all tables
    await ctx.runMutation(internal.todoist.internalMutations.clearAllData.clearAllData);

    return { success: true, message: "All Todoist data cleared" };
  },
});