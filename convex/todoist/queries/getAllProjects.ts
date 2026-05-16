import { v } from "convex/values";

import { authedQuery } from "../../_lib/authed";

export const getAllProjects = authedQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("todoist_projects")
      .filter(q =>
        q.and(
          q.eq(q.field("is_deleted"), false),
          q.eq(q.field("is_archived"), false)
        )
      )
      .collect();

    // Apply limit if specified
    if (args.limit && args.limit > 0) {
      return projects.slice(0, args.limit);
    }

    return projects;
  },
});