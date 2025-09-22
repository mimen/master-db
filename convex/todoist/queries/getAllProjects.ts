import { query } from "../../_generated/server";

export const getAllProjects = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("todoist_projects")
      .filter(q => q.eq(q.field("is_deleted"), 0))
      .collect();
  },
});