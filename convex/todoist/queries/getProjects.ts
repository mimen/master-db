import { query } from "../../_generated/server";

export const getProjects = query({
  handler: async (ctx) => {
    const projects = await ctx.db
      .query("todoist_projects")
      .collect();

    return projects.sort((a, b) => a.sync_version - b.sync_version);
  },
});