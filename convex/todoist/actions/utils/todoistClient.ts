import { TodoistApi } from "@doist/todoist-api-typescript";

// Type for consistent API responses
export type ActionResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// Helper to create Todoist API client
export const getTodoistClient = (): TodoistApi => {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) {
    throw new Error("TODOIST_API_TOKEN not configured");
  }

  return new TodoistApi(token);
};