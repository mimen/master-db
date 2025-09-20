import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// Type for consistent API responses
type ActionResponse<T> = 
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// Helper to create Todoist API v1 client
const getTodoistClient = () => {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) {
    throw new Error("TODOIST_API_TOKEN not configured");
  }
  
  return {
    // Execute commands via API v1 sync endpoint
    async executeCommands(commands: any[]) {
      const response = await fetch("https://api.todoist.com/api/v1/sync", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          commands,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Todoist API error ${response.status}: ${error}`);
      }

      const result = await response.json();
      
      // Check sync status
      if (result.sync_status && Object.values(result.sync_status).some((status: any) => status !== "ok")) {
        throw new Error(`Sync command failed: ${JSON.stringify(result.sync_status)}`);
      }

      return result;
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
      const tempId = crypto.randomUUID();
      const commandId = crypto.randomUUID();
      
      // Build command args
      const commandArgs: any = {
        content: args.content,
        priority: args.priority || 1,
      };

      if (args.projectId) commandArgs.project_id = args.projectId;
      if (args.sectionId) commandArgs.section_id = args.sectionId;
      if (args.labels?.length) commandArgs.labels = args.labels;
      if (args.description) commandArgs.description = args.description;
      if (args.due) {
        if (args.due.string) commandArgs.due_string = args.due.string;
        else if (args.due.datetime) commandArgs.due_datetime = args.due.datetime;
        else if (args.due.date) commandArgs.due_date = args.due.date;
      }

      // Execute command via Sync API v1
      const response = await client.executeCommands([{
        type: "item_add",
        temp_id: tempId,
        uuid: commandId,
        args: commandArgs,
      }]);

      // Get the real ID from temp_id_mapping
      const realId = response.temp_id_mapping?.[tempId];
      if (!realId) {
        throw new Error("Failed to get task ID from response");
      }

      // Store in Convex - we'll get full details from next sync
      await ctx.runMutation(internal.todoist.mutations.upsertItem, {
        item: {
          id: realId,
          content: args.content,
          project_id: args.projectId,
          section_id: args.sectionId,
          priority: args.priority || 1,
          labels: args.labels || [],
          description: args.description,
          checked: 0,
          is_deleted: 0,
          child_order: 0,
          comment_count: 0,
          added_at: new Date().toISOString(),
          user_id: "current",
          sync_version: Date.now(),
        },
      });

      return { success: true, data: { id: realId, ...commandArgs } };
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
      const commandId = crypto.randomUUID();
      
      // Build update args
      const updateArgs: any = {
        id: args.todoistId,
      };
      if (args.content !== undefined) updateArgs.content = args.content;
      if (args.priority !== undefined) updateArgs.priority = args.priority;
      if (args.labels !== undefined) updateArgs.labels = args.labels;
      if (args.description !== undefined) updateArgs.description = args.description;
      if (args.due) {
        if (args.due.string) updateArgs.due_string = args.due.string;
        else if (args.due.datetime) updateArgs.due_datetime = args.due.datetime;
        else if (args.due.date) updateArgs.due_date = args.due.date;
      }

      // Execute command via Sync API v1
      const response = await client.executeCommands([{
        type: "item_update",
        uuid: commandId,
        args: updateArgs,
      }]);

      // Update in Convex - remove the id field from updates
      const { id, ...updateFields } = updateArgs;
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates: {
          ...updateFields,
          sync_version: Date.now(),
        },
      });

      return { success: true, data: updateArgs };
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
      const commandId = crypto.randomUUID();
      
      // Execute command via API v1
      await client.executeCommands([{
        type: "item_complete",
        uuid: commandId,
        args: {
          id: args.todoistId,
        },
      }]);

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
      const commandId = crypto.randomUUID();
      
      // Execute command via API v1
      await client.executeCommands([{
        type: "item_uncomplete",
        uuid: commandId,
        args: {
          id: args.todoistId,
        },
      }]);

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
      const commandId = crypto.randomUUID();
      
      // Execute command via API v1
      await client.executeCommands([{
        type: "item_delete",
        uuid: commandId,
        args: {
          id: args.todoistId,
        },
      }]);

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
      const commandId = crypto.randomUUID();
      
      // Execute command via API v1
      const response = await client.executeCommands([{
        type: "item_move",
        uuid: commandId,
        args: {
          id: args.todoistId,
          project_id: args.projectId,
          section_id: args.sectionId,
        },
      }]);

      // Update in Convex - don't set section_id if not provided
      const updates: any = {
        project_id: args.projectId,
        sync_version: Date.now(),
      };
      
      if (args.sectionId) {
        updates.section_id = args.sectionId;
      }
      
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates,
      });

      return { success: true, data: response };
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
    
    try {
      // Build batch commands
      const commands = args.todoistIds.map(todoistId => ({
        type: "item_complete",
        uuid: crypto.randomUUID(),
        args: {
          id: todoistId,
        },
      }));

      // Execute all commands at once
      const response = await client.executeCommands(commands);
      
      // Update all items in Convex
      for (const todoistId of args.todoistIds) {
        await ctx.runMutation(internal.todoist.mutations.updateItem, {
          todoistId,
          updates: {
            checked: 1,
            sync_version: Date.now(),
          },
        });
      }

      return { success: true, data: { completed: args.todoistIds, failed: [] } };
    } catch (error: any) {
      console.error("Failed to complete tasks:", error);
      return {
        success: false,
        error: "Failed to complete tasks. Please try again.",
        code: "BATCH_COMPLETE_FAILED",
      };
    }
  },
});