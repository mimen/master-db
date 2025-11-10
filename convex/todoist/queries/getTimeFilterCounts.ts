import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

export const getTimeFilterCounts = query({
  args: {},
  handler: async (ctx): Promise<{
    totalRawTasks: number;
    totalFilteredTasks: number;
    totalTasksFilteredOut: number;
    timeCounts: Array<{
      filter: string;
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
      currentUserId: userId,
    });

    // Get current date strings for filtering (matching getActiveItems.ts logic)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString().split('T')[0];

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = tomorrow.toISOString().split('T')[0];

    const next7Days = new Date(today);
    next7Days.setDate(next7Days.getDate() + 7);
    const next7DaysISO = next7Days.toISOString().split('T')[0];

    // Helper to extract date-only part from date or datetime string
    const extractDateOnly = (dateStr: string): string => {
      return dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    };

    // Helper to check if item matches time filter
    const matchesTimeFilter = (item: Doc<"todoist_items">, filter: string): boolean => {
      if (filter === 'overdue') {
        if (!item.due?.date) return false;
        const dateOnly = extractDateOnly(item.due.date);
        return dateOnly < todayISO;
      }
      if (filter === 'today') {
        if (!item.due?.date) return false;
        const dateOnly = extractDateOnly(item.due.date);
        return dateOnly === todayISO;
      }
      if (filter === 'tomorrow') {
        if (!item.due?.date) return false;
        const dateOnly = extractDateOnly(item.due.date);
        return dateOnly === tomorrowISO;
      }
      if (filter === 'next7days') {
        if (!item.due?.date) return false;
        const dateOnly = extractDateOnly(item.due.date);
        return dateOnly > tomorrowISO && dateOnly <= next7DaysISO;
      }
      if (filter === 'future') {
        if (!item.due?.date) return false;
        const dateOnly = extractDateOnly(item.due.date);
        return dateOnly > next7DaysISO;
      }
      if (filter === 'nodate') {
        return !item.due?.date;
      }
      return false;
    };

    const timeFilters = [
      { filter: 'overdue', label: 'Overdue' },
      { filter: 'today', label: 'Today' },
      { filter: 'tomorrow', label: 'Tomorrow' },
      { filter: 'next7days', label: 'Next 7 Days' },
      { filter: 'future', label: 'Future' },
      { filter: 'nodate', label: 'No Date' },
    ];

    const timeCounts = timeFilters.map(({ filter, label }) => {
      const rawCount = rawActiveItems.filter(item => matchesTimeFilter(item, filter)).length;
      const filteredCount = filteredItems.filter(item => matchesTimeFilter(item, filter)).length;

      return {
        filter,
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
      timeCounts,
    };
  },
});
