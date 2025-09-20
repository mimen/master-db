import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// Type for consistent API responses
type ActionResponse<T> = 
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// Helper to create Todoist API client
const getTodoistClient = () => {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) {
    throw new Error("TODOIST_API_TOKEN not configured");
  }
  
  return {
    async request(endpoint: string, options: RequestInit = {}) {
      const response = await fetch(`https://api.todoist.com/rest/v2/${endpoint}`, {
        ...options,
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Todoist API error ${response.status}: ${error}`);
      }

      return response.json();
    }
  };
};

// Create a new task
export const createTask = action({
  args: {
    content: v.string(),
    projectId: v.optional(v.string()),
    sectionId: v.optional(v.string()),
    priority: v.optional(v.number()),
    due: v.optional(v.object({
      date: v.string(),
      string: v.optional(v.string()),
      datetime: v.optional(v.string()),
      timezone: v.optional(v.string()),
    })),
    labels: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ActionResponse<any>> => {
    try {
      const client = getTodoistClient();
      
      // Call Todoist API
      const task = await client.request("tasks", {
        method: "POST",
        body: JSON.stringify({
          content: args.content,
          project_id: args.projectId,
          section_id: args.sectionId,
          priority: args.priority || 1,
          due_date: args.due?.date,
          due_string: args.due?.string,
          due_datetime: args.due?.datetime,
          labels: args.labels || [],
          description: args.description,
        }),
      });

      // Store in Convex immediately
      await ctx.runMutation(internal.todoist.mutations.upsertItem, {
        item: {
          id: task.id,
          content: task.content,
          project_id: task.project_id,
          section_id: task.section_id,
          priority: task.priority,
          due: task.due,
          labels: task.labels,
          description: task.description,
          checked: 0,
          is_deleted: 0,
          child_order: task.order,
          parent_id: task.parent_id,
          assignee_id: task.assignee_id,
          assigner_id: task.assigner_id,
          comment_count: task.comment_count,
          added_at: task.created_at,
          sync_version: Date.now(), // Use timestamp as version
        },
      });

      return { success: true, data: task };
    } catch (error: any) {
      console.error("Failed to create task:", error);
      return {
        success: false,
        error: "Failed to create task. Please try again.",
        code: "CREATE_TASK_FAILED",
      };
    }
  },
});

// Update an existing task
export const updateTask = action({
  args: {
    todoistId: v.string(),
    content: v.optional(v.string()),
    priority: v.optional(v.number()),
    due: v.optional(v.object({
      date: v.string(),
      string: v.optional(v.string()),
      datetime: v.optional(v.string()),
      timezone: v.optional(v.string()),
    })),
    labels: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ActionResponse<any>> => {
    try {
      const client = getTodoistClient();
      
      // Build update payload
      const updates: any = {};
      if (args.content !== undefined) updates.content = args.content;
      if (args.priority !== undefined) updates.priority = args.priority;
      if (args.due !== undefined) {
        updates.due_date = args.due.date;
        if (args.due.string) updates.due_string = args.due.string;
        if (args.due.datetime) updates.due_datetime = args.due.datetime;
      }
      if (args.labels !== undefined) updates.labels = args.labels;
      if (args.description !== undefined) updates.description = args.description;

      // Call Todoist API
      const task = await client.request(`tasks/${args.todoistId}`, {
        method: "POST",
        body: JSON.stringify(updates),
      });

      // Update in Convex
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates: {
          ...updates,
          sync_version: Date.now(),
        },
      });

      return { success: true, data: task };
    } catch (error: any) {
      console.error("Failed to update task:", error);
      return {
        success: false,
        error: "Failed to update task. Please try again.",
        code: "UPDATE_TASK_FAILED",
      };
    }
  },
});

// Complete a task
export const completeTask = action({
  args: {
    todoistId: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<void>> => {
    try {
      const client = getTodoistClient();
      
      // Call Todoist API to close task
      await client.request(`tasks/${args.todoistId}/close`, {
        method: "POST",
      });

      // Update in Convex
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates: {
          checked: 1,
          sync_version: Date.now(),
        },
      });

      return { success: true, data: undefined };
    } catch (error: any) {
      console.error("Failed to complete task:", error);
      return {
        success: false,
        error: "Failed to complete task. Please try again.",
        code: "COMPLETE_TASK_FAILED",
      };
    }
  },
});

// Reopen a completed task
export const reopenTask = action({
  args: {
    todoistId: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<void>> => {
    try {
      const client = getTodoistClient();
      
      // Call Todoist API to reopen task
      await client.request(`tasks/${args.todoistId}/reopen`, {
        method: "POST",
      });

      // Update in Convex
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates: {
          checked: 0,
          sync_version: Date.now(),
        },
      });

      return { success: true, data: undefined };
    } catch (error: any) {
      console.error("Failed to reopen task:", error);
      return {
        success: false,
        error: "Failed to reopen task. Please try again.",
        code: "REOPEN_TASK_FAILED",
      };
    }
  },
});

// Delete a task
export const deleteTask = action({
  args: {
    todoistId: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<void>> => {
    try {
      const client = getTodoistClient();
      
      // Call Todoist API to delete task
      await client.request(`tasks/${args.todoistId}`, {
        method: "DELETE",
      });

      // Soft delete in Convex
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates: {
          is_deleted: 1,
          sync_version: Date.now(),
        },
      });

      return { success: true, data: undefined };
    } catch (error: any) {
      console.error("Failed to delete task:", error);
      return {
        success: false,
        error: "Failed to delete task. Please try again.",
        code: "DELETE_TASK_FAILED",
      };
    }
  },
});

// Move task to different project
export const moveTask = action({
  args: {
    todoistId: v.string(),
    projectId: v.string(),
    sectionId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ActionResponse<any>> => {
    try {
      const client = getTodoistClient();
      
      // Call Todoist API
      const task = await client.request(`tasks/${args.todoistId}`, {
        method: "POST",
        body: JSON.stringify({
          project_id: args.projectId,
          section_id: args.sectionId || null,
        }),
      });

      // Update in Convex
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates: {
          project_id: args.projectId,
          section_id: args.sectionId || null,
          sync_version: Date.now(),
        },
      });

      return { success: true, data: task };
    } catch (error: any) {
      console.error("Failed to move task:", error);
      return {
        success: false,
        error: "Failed to move task. Please try again.",
        code: "MOVE_TASK_FAILED",
      };
    }
  },
});

// Batch complete multiple tasks
export const completeMultipleTasks = action({
  args: {
    todoistIds: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<ActionResponse<{ completed: string[]; failed: string[] }>> => {
    const client = getTodoistClient();
    const completed: string[] = [];
    const failed: string[] = [];

    // Process each task
    for (const todoistId of args.todoistIds) {
      try {
        await client.request(`tasks/${todoistId}/close`, {
          method: "POST",
        });

        await ctx.runMutation(internal.todoist.mutations.updateItem, {
          todoistId,
          updates: {
            checked: 1,
            sync_version: Date.now(),
          },
        });

        completed.push(todoistId);
      } catch (error) {
        console.error(`Failed to complete task ${todoistId}:`, error);
        failed.push(todoistId);
      }
    }

    if (failed.length > 0) {
      return {
        success: false,
        error: `Failed to complete ${failed.length} task(s)`,
        code: "BATCH_COMPLETE_PARTIAL_FAILURE",
      };
    }

    return { success: true, data: { completed, failed } };
  },
});