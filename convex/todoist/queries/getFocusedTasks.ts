import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";
import { processQueue } from "../helpers/queueEngine";

export const getFocusedTasks = query({
  args: {
    context: v.optional(v.union(
      v.literal("work"),
      v.literal("personal"),
      v.literal("errands"),
      v.literal("all")
    )),
    timeframe: v.optional(v.union(
      v.literal("today"),
      v.literal("week"),
      v.literal("overdue"),
      v.literal("all")
    )),
    include_assigned_to_others: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const context = args.context || "all";
    const timeframe = args.timeframe || "today";
    const limit = args.limit || 10;
    const includeAssignedToOthers = args.include_assigned_to_others || false;

    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    const allItems: Doc<"todoist_items">[] = await ctx.runQuery(
      internal.todoist.internal.index.getFilteredActiveItems,
      {
        assigneeFilter: includeAssignedToOthers ? 'all' : 'not-assigned-to-others',
        currentUserId: userId,
      }
    );

    // Build filters based on context
    const filters = [];

    // Context-based filtering
    if (context !== "all") {
      const contextLabels = {
        work: ["work", "office", "meeting", "email", "calls"],
        personal: ["personal", "home", "family", "health"],
        errands: ["errands", "shopping", "phone", "admin", "quick"],
      };

      const labels = contextLabels[context as keyof typeof contextLabels] || [];
      if (labels.length > 0) {
        filters.push({
          type: "label" as const,
          labels,
          mode: "include" as const,
        });
      }
    }

    // Timeframe-based filtering
    switch (timeframe) {
      case "overdue":
        filters.push({
          type: "custom" as const,
          condition: "overdue",
          mode: "include" as const,
        });
        break;
      case "today":
        filters.push({
          type: "date" as const,
          range: "today" as const,
          mode: "include" as const,
        });
        // Also include overdue items for today's focus
        break;
      case "week":
        filters.push({
          type: "date" as const,
          range: "next7days" as const,
          mode: "include" as const,
        });
        break;
      // "all" means no time filtering
    }

    // Smart ordering based on context and timeframe
    const ordering = [];

    if (timeframe === "overdue") {
      // For overdue: priority first, then how overdue
      ordering.push(
        { field: "priority", direction: "desc" as const },
        { field: "dueDate", direction: "asc" as const }
      );
    } else if (timeframe === "today") {
      // For today: mix overdue + today, prioritize by urgency
      ordering.push(
        { field: "priority", direction: "desc" as const },
        { field: "dueDate", direction: "asc" as const, nullsFirst: false }
      );
    } else {
      // For week/all: balance priority with due dates
      ordering.push(
        { field: "dueDate", direction: "asc" as const, nullsFirst: false },
        { field: "priority", direction: "desc" as const },
        { field: "childOrder", direction: "asc" as const }
      );
    }

    const queueConfig = {
      filters,
      ordering,
      maxTasks: limit,
    };

    // Special handling for "today" to include overdue items
    let processedItems;
    if (timeframe === "today") {
      // Get overdue items
      const overdueConfig = {
        filters: [
          ...filters.filter(f => f.type !== "date"),
          { type: "custom" as const, condition: "overdue" },
        ],
        ordering,
        maxTasks: Math.ceil(limit * 0.4), // 40% for overdue
      };

      // Get today items
      const todayConfig = {
        ...queueConfig,
        maxTasks: Math.ceil(limit * 0.6), // 60% for today
      };

      const overdueItems = processQueue(allItems, overdueConfig, userId);
      const todayItems = processQueue(allItems, todayConfig, userId);

      // Combine and deduplicate
      const seenIds = new Set<string>();
      processedItems = [];

      // Add overdue first
      for (const item of overdueItems) {
        if (!seenIds.has(item.todoist_id)) {
          processedItems.push(item);
          seenIds.add(item.todoist_id);
        }
      }

      // Add today items
      for (const item of todayItems) {
        if (!seenIds.has(item.todoist_id) && processedItems.length < limit) {
          processedItems.push(item);
          seenIds.add(item.todoist_id);
        }
      }
    } else {
      processedItems = processQueue(allItems, queueConfig, userId);
    }

    // Apply global filters
    return processedItems;
  },
});