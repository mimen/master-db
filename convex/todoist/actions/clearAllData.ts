import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

export const clearAllData = action({
  args: {},
  handler: async (ctx) => {
    console.warn("WARNING: Clearing all Todoist data from the database");

    // Clear all tables
    await ctx.runMutation(internal.todoist.mutations.clearAllData);

    return { success: true, message: "All Todoist data cleared" };
  },
});