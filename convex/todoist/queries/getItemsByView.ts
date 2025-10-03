import { v } from "convex/values";

import { api, internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

export const getItemsByView = query({
  args: {
    view: v.string(),
    inboxProjectId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<"todoist_items">[]> => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    if (args.view === "inbox" && args.inboxProjectId) {
      return ctx.runQuery(internal.todoist.internal.index.getFilteredActiveItems, {
        projectId: args.inboxProjectId,
        currentUserId: userId,
      });
    }

    if (args.view === "today" || args.view === "time:today") {
      return ctx.runQuery(api.todoist.publicQueries.getDueTodayItems, {});
    }

    if (args.view === "upcoming" || args.view === "time:upcoming") {
      return ctx.runQuery(api.todoist.publicQueries.getDueNext7DaysItems, {});
    }

    if (args.view === "time:overdue") {
      return ctx.runQuery(api.todoist.publicQueries.getOverdueItems, {});
    }

    if (args.view === "time:no-date") {
      return ctx.runQuery(api.todoist.publicQueries.getNoDueDateItems, {});
    }

    if (args.view.startsWith("project:")) {
      const projectId = args.view.replace("project:", "");
      return ctx.runQuery(internal.todoist.internal.index.getFilteredActiveItems, {
        projectId,
        currentUserId: userId,
      });
    }

    if (args.view.startsWith("priority:")) {
      const priorityLevel =
        args.view === "priority:p1" ? 4 :
        args.view === "priority:p2" ? 3 :
        args.view === "priority:p3" ? 2 : 1;
      return ctx.runQuery(internal.todoist.internal.index.getFilteredActiveItems, {
        priority: priorityLevel,
        currentUserId: userId,
      });
    }

    if (args.view.startsWith("label:")) {
      const allItems: Doc<"todoist_items">[] = await ctx.runQuery(internal.todoist.internal.index.getFilteredActiveItems, {
        currentUserId: userId,
      });
      const labelName = args.view.replace("label:", "");
      return allItems.filter((task: Doc<"todoist_items">) => task.labels.includes(labelName));
    }

    return [];
  },
});
