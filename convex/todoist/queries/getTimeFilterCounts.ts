import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

export const getTimeFilterCounts = query({
  args: {
    timezoneOffsetMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
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

    // Get current time in user's timezone
    const offsetMs = (args.timezoneOffsetMinutes ?? 0) * 60 * 1000;
    const nowUTC = Date.now();
    const nowLocal = new Date(nowUTC + offsetMs);

    // Get today's date string in user's local timezone (YYYY-MM-DD)
    const year = nowLocal.getUTCFullYear();
    const month = String(nowLocal.getUTCMonth() + 1).padStart(2, '0');
    const day = String(nowLocal.getUTCDate()).padStart(2, '0');
    const todayISO = `${year}-${month}-${day}`;

    // Calculate tomorrow in user's timezone
    const tomorrowLocal = new Date(nowLocal);
    tomorrowLocal.setUTCDate(tomorrowLocal.getUTCDate() + 1);
    const tomorrowYear = tomorrowLocal.getUTCFullYear();
    const tomorrowMonth = String(tomorrowLocal.getUTCMonth() + 1).padStart(2, '0');
    const tomorrowDay = String(tomorrowLocal.getUTCDate()).padStart(2, '0');
    const tomorrowISO = `${tomorrowYear}-${tomorrowMonth}-${tomorrowDay}`;

    // Calculate 7 days from today in user's timezone
    const next7DaysLocal = new Date(nowLocal);
    next7DaysLocal.setUTCDate(next7DaysLocal.getUTCDate() + 7);
    const next7Year = next7DaysLocal.getUTCFullYear();
    const next7Month = String(next7DaysLocal.getUTCMonth() + 1).padStart(2, '0');
    const next7Day = String(next7DaysLocal.getUTCDate()).padStart(2, '0');
    const next7DaysISO = `${next7Year}-${next7Month}-${next7Day}`;

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
