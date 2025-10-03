import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

export const getPriorityFilterCounts = query({
  args: {},
  handler: async (ctx): Promise<{
    totalRawTasks: number;
    totalFilteredTasks: number;
    totalTasksFilteredOut: number;
    priorityCounts: Array<{
      priority: number;
      label: string;
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

    const filteredItems: Doc<"todoist_items">[] = await ctx.runQuery(internal.todoist.internal.index.getFilteredActiveItems, {
      assigneeFilter: 'all',
      currentUserId: userId,
    });

    // Todoist priorities: 4 = P1 (highest), 3 = P2, 2 = P3, 1 = P4 (normal)
    const priorities = [
      { priority: 4, label: 'P1 (Urgent)' },
      { priority: 3, label: 'P2 (High)' },
      { priority: 2, label: 'P3 (Medium)' },
      { priority: 1, label: 'P4 (Normal)' },
    ];

    const priorityCounts = priorities.map(({ priority, label }) => {
      const rawCount = rawActiveItems.filter(item => item.priority === priority).length;
      const filteredCount = filteredItems.filter(item => item.priority === priority).length;

      return {
        priority,
        label,
        rawTaskCount: rawCount,
        filteredTaskCount: filteredCount,
        tasksFilteredOut: rawCount - filteredCount,
      };
    });

    return {
      totalRawTasks: rawActiveItems.length,
      totalFilteredTasks: filteredItems.length,
      totalTasksFilteredOut: rawActiveItems.length - filteredItems.length,
      priorityCounts,
    };
  },
});
