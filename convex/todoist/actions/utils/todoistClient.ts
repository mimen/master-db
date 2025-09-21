// Type for consistent API responses
export type ActionResponse<T> = 
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// Helper to create Todoist API v1 client
export const getTodoistClient = () => {
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