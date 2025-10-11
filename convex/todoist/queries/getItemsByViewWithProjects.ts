import { v } from "convex/values";

import { api, internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

type TimeRange = "overdue" | "today" | "upcoming" | "no-date";

type InboxQuery = { type: "inbox"; view: string; inboxProjectId?: string }
type TimeQuery = { type: "time"; view: string; range: TimeRange }
type ProjectQuery = { type: "project"; view: string; projectId: string }
type PriorityQuery = { type: "priority"; view: string; priority: 1 | 2 | 3 | 4 }
type LabelQuery = { type: "label"; view: string; label: string }

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
  }),
  v.object({
    type: v.literal("time"),
    view: v.string(),
    range: timeRangeValidator,
  }),
  v.object({
    type: v.literal("project"),
    view: v.string(),
    projectId: v.string(),
  }),
  v.object({
    type: v.literal("priority"),
    view: v.string(),
    priority: v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4)),
  }),
  v.object({
    type: v.literal("label"),
    view: v.string(),
    label: v.string(),
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

      items = await ctx.runQuery(internal.todoist.internal.index.getFilteredActiveItems, {
        projectId: list.inboxProjectId,
        currentUserId: userId,
      });
    } else if (list.type === "time") {
      if (list.range === "today") {
        items = await ctx.runQuery(api.todoist.publicQueries.getDueTodayItems, {});
      } else if (list.range === "upcoming") {
        items = await ctx.runQuery(api.todoist.publicQueries.getDueNext7DaysItems, {});
      } else if (list.range === "overdue") {
        items = await ctx.runQuery(api.todoist.publicQueries.getOverdueItems, {});
      } else if (list.range === "no-date") {
        items = await ctx.runQuery(api.todoist.publicQueries.getNoDueDateItems, {});
      }
    } else if (list.type === "project") {
      items = await ctx.runQuery(internal.todoist.internal.index.getFilteredActiveItems, {
        projectId: list.projectId,
        currentUserId: userId,
      });
    } else if (list.type === "priority") {
      items = await ctx.runQuery(internal.todoist.internal.index.getFilteredActiveItems, {
        priority: list.priority,
        currentUserId: userId,
      });
    } else if (list.type === "label") {
      items = await ctx.runQuery(internal.todoist.internal.index.getFilteredActiveItems, {
        label: list.label,
        currentUserId: userId,
      });
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
