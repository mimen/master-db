import { v } from "convex/values";

import { api, internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";
import { applyGlobalFilters } from "../helpers/globalFilters";

export const getItemsByView = query({
  args: {
    view: v.string(),
    inboxProjectId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<"todoist_items">[]> => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    if (args.view === "inbox" && args.inboxProjectId) {
      const rawItems = await ctx.runQuery(internal.todoist.internal.index.getRawActiveItems, {
        projectId: args.inboxProjectId
      });
      return applyGlobalFilters(rawItems, { currentUserId: userId });
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
      const rawItems = await ctx.runQuery(internal.todoist.internal.index.getRawActiveItems, {
        projectId
      });
      return applyGlobalFilters(rawItems, { currentUserId: userId });
    }

    if (args.view.startsWith("priority:")) {
      const allItems: Doc<"todoist_items">[] = await ctx.runQuery(internal.todoist.internal.index.getRawActiveItems, {});
      const filteredItems = applyGlobalFilters(allItems, { currentUserId: userId });
      const priorityLevel =
        args.view === "priority:p1" ? 4 :
        args.view === "priority:p2" ? 3 :
        args.view === "priority:p3" ? 2 : 1;
      return filteredItems.filter((task: Doc<"todoist_items">) => task.priority === priorityLevel);
    }

    if (args.view.startsWith("label:")) {
      const allItems: Doc<"todoist_items">[] = await ctx.runQuery(internal.todoist.internal.index.getRawActiveItems, {});
      const filteredItems = applyGlobalFilters(allItems, { currentUserId: userId });
      const labelName = args.view.replace("label:", "");
      return filteredItems.filter((task: Doc<"todoist_items">) => task.labels.includes(labelName));
    }

    return [];
  },
});
