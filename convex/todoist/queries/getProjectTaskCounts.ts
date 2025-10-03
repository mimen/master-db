import { internal } from "../../_generated/api";
import { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

export const getProjectTaskCounts = query({
  args: {},
  handler: async (ctx): Promise<{
    totalProjects: number;
    totalRawTasks: number;
    totalFilteredTasks: number;
    totalTasksFilteredOut: number;
    projectCounts: Array<{
      projectId: string;
      projectName: string;
      rawTaskCount: number;
      filteredTaskCount: number;
      tasksFilteredOut: number;
    }>;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    const rawActiveItems: Doc<"todoist_items">[] = await ctx.db
      .query("todoist_items")
      .withIndex("active_items", (q) => q.eq("is_deleted", false).eq("checked", false))
      .collect();

    const projects = await ctx.db
      .query("todoist_projects")
      .filter((q) => q.eq(q.field("is_deleted"), false))
      .collect();

    const filteredItems: Doc<"todoist_items">[] = await ctx.runQuery(internal.todoist.internal.index.getFilteredActiveItems, {
      currentUserId: userId,
    });

    // Count tasks per project
    const projectCounts = projects.map(project => {
      const rawCount = rawActiveItems.filter(item => item.project_id === project.todoist_id).length;
      const filteredCount = filteredItems.filter(item => item.project_id === project.todoist_id).length;

      return {
        projectId: project.todoist_id,
        projectName: project.name,
        rawTaskCount: rawCount,
        filteredTaskCount: filteredCount,
        tasksFilteredOut: rawCount - filteredCount
      };
    });

    // Sort by highest raw task count
    projectCounts.sort((a, b) => b.rawTaskCount - a.rawTaskCount);

    return {
      totalProjects: projects.length,
      totalRawTasks: rawActiveItems.length,
      totalFilteredTasks: filteredItems.length,
      totalTasksFilteredOut: rawActiveItems.length - filteredItems.length,
      projectCounts: projectCounts.slice(0, 20) // Top 20 projects
    };
  },
});