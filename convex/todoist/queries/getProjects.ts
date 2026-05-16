import { v } from "convex/values";

import { authedQuery } from "../../_lib/authed";

export const getProjects = authedQuery({
  handler: async (ctx) => {
    const projects = await ctx.db
      .query("todoist_projects")
      .filter((q) => q.eq(q.field("is_archived"), false))
      .collect();

    return projects.sort((a, b) => a.sync_version - b.sync_version);
  },
});

export const getProjectByTodoistId = authedQuery({
  args: {
    todoistId: v.string(),
  },
  handler: async (ctx, { todoistId }) => {
    const project = await ctx.db
      .query("todoist_projects")
      .filter((q) => q.eq(q.field("todoist_id"), todoistId))
      .first();

    return project;
  },
});