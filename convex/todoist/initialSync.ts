import { action } from "../_generated/server";
import { internal } from "../_generated/api";

export const runInitialSync = action({
  handler: async (ctx) => {
    console.log("Starting initial Todoist sync using API v1...");
    
    const token = process.env.TODOIST_API_TOKEN;
    if (!token) {
      throw new Error("TODOIST_API_TOKEN not configured");
    }

    // Initialize sync state
    await ctx.runMutation(internal.todoist.mutations.initializeSyncState);

    // Perform full sync using API v1
    const response = await fetch("https://api.todoist.com/api/v1/sync", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sync_token: "*",
        resource_types: ["projects", "items", "labels", "sections", "notes", "reminders"],
      }),
    });

    if (!response.ok) {
      throw new Error(`Todoist API error: ${response.status}`);
    }

    const syncData = await response.json();

    // Store projects
    console.log(`Syncing ${syncData.projects.length} projects...`);
    for (const project of syncData.projects) {
      await ctx.runMutation(internal.todoist.mutations.upsertProject, {
        project,
      });
    }

    // Store items
    console.log(`Syncing ${syncData.items.length} items...`);
    for (const item of syncData.items) {
      await ctx.runMutation(internal.todoist.mutations.upsertItem, {
        item: item,
      });
    }

    // Update sync token
    await ctx.runMutation(internal.todoist.mutations.updateSyncToken, {
      token: syncData.sync_token,
    });

    return {
      projectsCount: syncData.projects.length,
      itemsCount: syncData.items.length,
      syncToken: syncData.sync_token,
    };
  },
});