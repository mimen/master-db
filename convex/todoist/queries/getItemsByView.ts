import { v } from "convex/values";

import { api, internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

type TimeRange = "overdue" | "today" | "upcoming" | "no-date";

type InboxQuery = { type: "inbox"; view: string; inboxProjectId?: string; timezoneOffsetMinutes?: number }
type TimeQuery = { type: "time"; view: string; range: TimeRange; timezoneOffsetMinutes?: number }
type ProjectQuery = { type: "project"; view: string; projectId: string; timezoneOffsetMinutes?: number }
type PriorityQuery = { type: "priority"; view: string; priority: 1 | 2 | 3 | 4; timezoneOffsetMinutes?: number }
type LabelQuery = { type: "label"; view: string; label: string; timezoneOffsetMinutes?: number }

type ListQueryInput = InboxQuery | TimeQuery | ProjectQuery | PriorityQuery | LabelQuery;

const timeRangeValidator = v.union(
  v.literal("overdue"),
  v.literal("today"),
  v.literal("upcoming"),
  v.literal("no-date")
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
  })
);

export const getItemsByView = query({
  args: {
    list: listQueryValidator,
  },
  handler: async (
    ctx,
    args
  ): Promise<Doc<"todoist_items">[]> => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;
    const list = args.list as ListQueryInput;

    if (list.type === "inbox") {
      if (!list.inboxProjectId) {
        return [];
      }

      return ctx.runQuery(internal.todoist.internalQueries.getFilteredActiveItems.getFilteredActiveItems, {
        projectId: list.inboxProjectId,
        currentUserId: userId,
      });
    }

    if (list.type === "time") {
      if (list.range === "today") {
        return ctx.runQuery(api.todoist.queries.getDueTodayItems.getDueTodayItems, {
          timezoneOffsetMinutes: list.timezoneOffsetMinutes,
        });
      }

      if (list.range === "upcoming") {
        return ctx.runQuery(api.todoist.queries.getDueNext7DaysItems.getDueNext7DaysItems, {
          timezoneOffsetMinutes: list.timezoneOffsetMinutes,
        });
      }

      if (list.range === "overdue") {
        return ctx.runQuery(api.todoist.queries.getOverdueItems.getOverdueItems, {});
      }

      if (list.range === "no-date") {
        return ctx.runQuery(api.todoist.queries.getNoDueDateItems.getNoDueDateItems, {});
      }

      return [];
    }

    if (list.type === "project") {
      return ctx.runQuery(internal.todoist.internalQueries.getFilteredActiveItems.getFilteredActiveItems, {
        projectId: list.projectId,
        currentUserId: userId,
      });
    }

    if (list.type === "priority") {
      return ctx.runQuery(internal.todoist.internalQueries.getFilteredActiveItems.getFilteredActiveItems, {
        priority: list.priority,
        currentUserId: userId,
      });
    }

    if (list.type === "label") {
      return ctx.runQuery(internal.todoist.internalQueries.getFilteredActiveItems.getFilteredActiveItems, {
        label: list.label,
        currentUserId: userId,
      });
    }

    return [];
  },
});
