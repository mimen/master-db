import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

export const getLabelFilterCounts = query({
  args: {},
  handler: async (ctx): Promise<{
    totalRawTasks: number;
    totalFilteredTasks: number;
    totalTasksFilteredOut: number;
    labelCounts: Array<{
      labelId: string;
      labelName: string;
      rawTaskCount: number;
      filteredTaskCount: number;
      tasksFilteredOut: number;
    }>;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    const rawActiveItems: Doc<"todoist_items">[] = await ctx.db
      .query("todoist_items")
      .withIndex("active_items", (q) => q.eq("is_deleted", false).eq("checked", false))
      .collect();

    const labels = await ctx.db
      .query("todoist_labels")
      .filter((q) => q.eq(q.field("is_deleted"), false))
      .collect();

    const filteredItems: Doc<"todoist_items">[] = await ctx.runQuery(internal.todoist.internalQueries.getFilteredActiveItems.getFilteredActiveItems, {
      currentUserId: userId,
    });

    // Count tasks per label
    const labelCounts = labels.map(label => {
      const rawCount = rawActiveItems.filter(item =>
        item.labels && item.labels.includes(label.name)
      ).length;
      const filteredCount = filteredItems.filter(item =>
        item.labels && item.labels.includes(label.name)
      ).length;

      return {
        labelId: label.todoist_id,
        labelName: label.name,
        rawTaskCount: rawCount,
        filteredTaskCount: filteredCount,
        tasksFilteredOut: rawCount - filteredCount,
      };
    });

    // Sort by highest raw task count
    labelCounts.sort((a, b) => b.rawTaskCount - a.rawTaskCount);

    return {
      totalRawTasks: rawActiveItems.length,
      totalFilteredTasks: filteredItems.length,
      totalTasksFilteredOut: rawActiveItems.length - filteredItems.length,
      labelCounts: labelCounts.slice(0, 50), // Top 50 labels
    };
  },
});
