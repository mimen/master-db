import { v } from "convex/values";

import { api, internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

type TimeRange = "overdue" | "today" | "upcoming" | "no-date";

type InboxQuery = { type: "inbox"; inboxProjectId?: string }
type TimeQuery = { type: "time"; range: TimeRange }
type ProjectQuery = { type: "project"; projectId: string }
type PriorityQuery = { type: "priority"; priority: 1 | 2 | 3 | 4 }
type LabelQuery = { type: "label"; label: string }

type ListQueryInput = InboxQuery | TimeQuery | ProjectQuery | PriorityQuery | LabelQuery;

const timeRangeValidator = v.union(
  v.literal("overdue"),
  v.literal("today"),
  v.literal("upcoming"),
  v.literal("no-date")
);

const inboxValidator = v.object({
  type: v.literal("inbox"),
  inboxProjectId: v.optional(v.string()),
});

const listQueryValidator = v.union(
  inboxValidator,
  v.object({
    type: v.literal("time"),
    range: timeRangeValidator,
  }),
  v.object({
    type: v.literal("project"),
    projectId: v.string(),
  }),
  v.object({
    type: v.literal("priority"),
    priority: v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4)),
  }),
  v.object({
    type: v.literal("label"),
    label: v.string(),
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

      return ctx.runQuery(internal.todoist.internal.index.getFilteredActiveItems, {
        projectId: list.inboxProjectId,
        currentUserId: userId,
      });
    }

    if (list.type === "time") {
      if (list.range === "today") {
        return ctx.runQuery(api.todoist.publicQueries.getDueTodayItems, {});
      }

      if (list.range === "upcoming") {
        return ctx.runQuery(api.todoist.publicQueries.getDueNext7DaysItems, {});
      }

      if (list.range === "overdue") {
        return ctx.runQuery(api.todoist.publicQueries.getOverdueItems, {});
      }

      if (list.range === "no-date") {
        return ctx.runQuery(api.todoist.publicQueries.getNoDueDateItems, {});
      }

      return [];
    }

    if (list.type === "project") {
      return ctx.runQuery(internal.todoist.internal.index.getFilteredActiveItems, {
        projectId: list.projectId,
        currentUserId: userId,
      });
    }

    if (list.type === "priority") {
      return ctx.runQuery(internal.todoist.internal.index.getFilteredActiveItems, {
        priority: list.priority,
        currentUserId: userId,
      });
    }

    if (list.type === "label") {
      return ctx.runQuery(internal.todoist.internal.index.getFilteredActiveItems, {
        label: list.label,
        currentUserId: userId,
      });
    }

    return [];
  },
});
