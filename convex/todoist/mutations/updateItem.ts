import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

export const updateItem = internalMutation({
  args: { 
    todoistId: v.string(),
    updates: v.any(),
  },
  handler: async (ctx, { todoistId, updates }) => {
    const existing = await ctx.db
      .query("todoist_items")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", todoistId))
      .first();
      
    if (!existing) {
      console.error(`Item not found: ${todoistId}`);
      return;
    }
    
    // Apply updates
    await ctx.db.patch(existing._id, updates);
  },
});