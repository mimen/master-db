import { v } from "convex/values";

import { api, internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

type TimeRange = "overdue" | "today" | "upcoming" | "no-date";
type RoutineTaskFilter = "overdue" | "morning" | "night" | "todays" | "get-ahead";

type InboxQuery = { type: "inbox"; view: string; inboxProjectId?: string; timezoneOffsetMinutes?: number }
type TimeQuery = { type: "time"; view: string; range: TimeRange; timezoneOffsetMinutes?: number }
type ProjectQuery = { type: "project"; view: string; projectId: string; timezoneOffsetMinutes?: number }
type PriorityQuery = { type: "priority"; view: string; priority: 1 | 2 | 3 | 4; timezoneOffsetMinutes?: number }
type LabelQuery = { type: "label"; view: string; label: string; timezoneOffsetMinutes?: number }
type RoutineTaskQuery = { type: "routine-tasks"; view: string; filter: RoutineTaskFilter; timezoneOffsetMinutes?: number }

type ListQueryInput = InboxQuery | TimeQuery | ProjectQuery | PriorityQuery | LabelQuery | RoutineTaskQuery;

const timeRangeValidator = v.union(
  v.literal("overdue"),
  v.literal("today"),
  v.literal("upcoming"),
  v.literal("no-date")
);

const routineTaskFilterValidator = v.union(
  v.literal("overdue"),
  v.literal("morning"),
  v.literal("night"),
  v.literal("todays"),
  v.literal("get-ahead")
);

const listQueryValidator = v.union(
  v.object({
    type: v.literal("inbox"),
    view: v.string(),
    inboxProjectId: v.optional(v.string()),
    timezoneOffsetMinutes: v.optional(v.number()),
  }),
  v.object({
    type: v.literal("time"),
    view: v.string(),
    range: timeRangeValidator,
    timezoneOffsetMinutes: v.optional(v.number()),
  }),
  v.object({
    type: v.literal("project"),
    view: v.string(),
    projectId: v.string(),
    timezoneOffsetMinutes: v.optional(v.number()),
  }),
  v.object({
    type: v.literal("priority"),
    view: v.string(),
    priority: v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4)),
    timezoneOffsetMinutes: v.optional(v.number()),
  }),
  v.object({
    type: v.literal("label"),
    view: v.string(),
    label: v.string(),
    timezoneOffsetMinutes: v.optional(v.number()),
  }),
  v.object({
    type: v.literal("routine-tasks"),
    view: v.string(),
    filter: routineTaskFilterValidator,
    timezoneOffsetMinutes: v.optional(v.number()),
  })
);

export type TodoistItemWithProject = Doc<"todoist_items"> & {
  project?: {
    todoist_id: string;
    name: string;
    color: string;
  } | null;
};

export const getItemsByViewWithProjects = query({
  args: {
    list: listQueryValidator,
  },
  handler: async (
    ctx,
    args
  ): Promise<TodoistItemWithProject[]> => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;
    const list = args.list as ListQueryInput;

    let items: Doc<"todoist_items">[] = [];

    if (list.type === "inbox") {
      if (!list.inboxProjectId) {
        return [];
      }

      items = await ctx.runQuery(internal.todoist.internalQueries.getFilteredActiveItems.getFilteredActiveItems, {
        projectId: list.inboxProjectId,
        currentUserId: userId,
      });
    } else if (list.type === "time") {
      if (list.range === "today") {
        items = await ctx.runQuery(api.todoist.queries.getDueTodayItems.getDueTodayItems, {
          timezoneOffsetMinutes: list.timezoneOffsetMinutes,
        });
      } else if (list.range === "upcoming") {
        items = await ctx.runQuery(api.todoist.queries.getDueNext7DaysItems.getDueNext7DaysItems, {
          timezoneOffsetMinutes: list.timezoneOffsetMinutes,
        });
      } else if (list.range === "overdue") {
        items = await ctx.runQuery(api.todoist.queries.getOverdueItems.getOverdueItems, {});
      } else if (list.range === "no-date") {
        items = await ctx.runQuery(api.todoist.queries.getNoDueDateItems.getNoDueDateItems, {});
      }
    } else if (list.type === "project") {
      items = await ctx.runQuery(internal.todoist.internalQueries.getFilteredActiveItems.getFilteredActiveItems, {
        projectId: list.projectId,
        currentUserId: userId,
      });
    } else if (list.type === "priority") {
      items = await ctx.runQuery(internal.todoist.internalQueries.getFilteredActiveItems.getFilteredActiveItems, {
        priority: list.priority,
        currentUserId: userId,
      });
    } else if (list.type === "label") {
      items = await ctx.runQuery(internal.todoist.internalQueries.getFilteredActiveItems.getFilteredActiveItems, {
        label: list.label,
        currentUserId: userId,
      });
    } else if (list.type === "routine-tasks") {
      // Get all active items with routine label
      const allItems = await ctx.runQuery(internal.todoist.internalQueries.getFilteredActiveItems.getFilteredActiveItems, {
        label: "routine",
        currentUserId: userId,
      });

      // Get timezone info
      const offsetMs = (list.timezoneOffsetMinutes ?? 0) * 60 * 1000;
      const nowUTC = Date.now();
      const nowLocal = new Date(nowUTC + offsetMs);
      const year = nowLocal.getUTCFullYear();
      const month = String(nowLocal.getUTCMonth() + 1).padStart(2, '0');
      const day = String(nowLocal.getUTCDate()).padStart(2, '0');
      const todayISO = `${year}-${month}-${day}`;

      // Calculate 5 days from today for Ready to Go filter
      const fiveDaysLocal = new Date(nowLocal);
      fiveDaysLocal.setUTCDate(fiveDaysLocal.getUTCDate() + 5);
      const fiveDaysYear = fiveDaysLocal.getUTCFullYear();
      const fiveDaysMonth = String(fiveDaysLocal.getUTCMonth() + 1).padStart(2, '0');
      const fiveDaysDay = String(fiveDaysLocal.getUTCDate()).padStart(2, '0');
      const fiveDaysISO = `${fiveDaysYear}-${fiveDaysMonth}-${fiveDaysDay}`;

      // Helper to extract date-only part from date or datetime string
      const extractDateOnly = (dateStr: string): string => {
        return dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
      };

      // Apply filter-specific logic
      if (list.filter === "overdue") {
        // Either due date OR deadline is overdue
        items = allItems.filter(item => {
          const dueDate = item.due?.date ? extractDateOnly(item.due.date) : null;
          const deadlineDate = item.deadline?.date ?? null;
          return (dueDate && dueDate < todayISO) || (deadlineDate && deadlineDate < todayISO);
        });
      } else if (list.filter === "morning") {
        // Due date is today + morning label
        items = allItems.filter(item => {
          if (!item.labels?.includes("morning")) return false;
          if (!item.due?.date) return false;
          const dueDate = extractDateOnly(item.due.date);
          return dueDate === todayISO;
        });
      } else if (list.filter === "night") {
        // Due date is today + night label
        items = allItems.filter(item => {
          if (!item.labels?.includes("night")) return false;
          if (!item.due?.date) return false;
          const dueDate = extractDateOnly(item.due.date);
          return dueDate === todayISO;
        });
      } else if (list.filter === "todays") {
        // Ready to Go: due date is today OR deadline within next 7 days
        // Excludes morning/night routines with due date today
        items = allItems.filter(item => {
          const dueDate = item.due?.date ? extractDateOnly(item.due.date) : null;
          const deadlineDate = item.deadline?.date ?? null;

          // Due date is today (but not morning/night)
          if (dueDate === todayISO) {
            if (item.labels?.includes("morning") || item.labels?.includes("night")) {
              return false;
            }
            return true;
          }

          // Deadline is within next 5 days (today through +5)
          if (deadlineDate && deadlineDate >= todayISO && deadlineDate <= fiveDaysISO) {
            return true;
          }

          return false;
        });
      } else if (list.filter === "get-ahead") {
        // Deadline is beyond 5 days from now
        items = allItems.filter(item => {
          const deadlineDate = item.deadline?.date ?? null;
          if (!deadlineDate) return false;
          return deadlineDate > fiveDaysISO;
        });
      }
    }

    // Enrich items with project information
    const enrichedItems: TodoistItemWithProject[] = await Promise.all(
      items.map(async (item) => {
        if (!item.project_id) {
          return { ...item, project: null };
        }

        const project = await ctx.db
          .query("todoist_projects")
          .withIndex("by_todoist_id", (q) => q.eq("todoist_id", item.project_id!))
          .first();

        if (!project) {
          return { ...item, project: null };
        }

        return {
          ...item,
          project: {
            todoist_id: project.todoist_id,
            name: project.name,
            color: project.color,
          },
        };
      })
    );

    return enrichedItems;
  },
});
