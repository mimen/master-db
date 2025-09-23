import { query } from "../../_generated/server";
import { applyGlobalFilters } from "../helpers/globalFilters";

/**
 * Get task counts per project with both raw and filtered counts.
 */
export const getProjectTaskCounts = query({
  args: {},
  handler: async (ctx) => {
    // Get all active items
    const rawActiveItems = await ctx.db
      .query("todoist_items")
      .filter((q) => q.eq(q.field("checked"), false))
      .filter((q) => q.eq(q.field("is_deleted"), false))
      .collect();

    // Get all projects
    const projects = await ctx.db
      .query("todoist_projects")
      .filter((q) => q.eq(q.field("is_deleted"), false))
      .collect();

    // Apply global filters
    const filteredItems = applyGlobalFilters(rawActiveItems, {
      assigneeFilter: 'all'
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