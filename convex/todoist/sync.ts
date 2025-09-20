import { action } from "../_generated/server";
import { internal } from "../_generated/api";

export const performIncrementalSync = action({
  handler: async (ctx) => {
    console.log("Starting incremental Todoist sync...");
    
    const token = process.env.TODOIST_API_TOKEN;
    if (!token) {
      throw new Error("TODOIST_API_TOKEN not configured");
    }

    // Get current sync state
    const syncState = await ctx.runQuery(internal.todoist.queries.getSyncState);
    if (!syncState?.last_sync_token) {
      console.log("No sync token found, running initial sync instead");
      return ctx.runAction(internal.todoist.initialSync.runInitialSync);
    }

    // Perform incremental sync
    const response = await fetch("https://api.todoist.com/api/v1/sync", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sync_token: syncState.last_sync_token,
        resource_types: ["projects", "items", "labels", "sections", "notes", "reminders"],
      }),
    });

    if (!response.ok) {
      throw new Error(`Todoist API error: ${response.status}`);
    }

    const syncData = await response.json();

    // Check if this is a full sync
    if (syncData.full_sync) {
      console.log("Full sync required by Todoist");
      return ctx.runAction(internal.todoist.initialSync.runInitialSync);
    }

    let changeCount = 0;

    // Process projects
    if (syncData.projects && syncData.projects.length > 0) {
      console.log(`Processing ${syncData.projects.length} project changes...`);
      for (const project of syncData.projects) {
        await ctx.runMutation(internal.todoist.mutations.upsertProject, {
          project,
        });
        changeCount++;
      }
    }

    // Process sections
    if (syncData.sections && syncData.sections.length > 0) {
      console.log(`Processing ${syncData.sections.length} section changes...`);
      for (const section of syncData.sections) {
        await ctx.runMutation(internal.todoist.mutations.upsertSection, {
          section,
        });
        changeCount++;
      }
    }

    // Process labels
    if (syncData.labels && syncData.labels.length > 0) {
      console.log(`Processing ${syncData.labels.length} label changes...`);
      for (const label of syncData.labels) {
        await ctx.runMutation(internal.todoist.mutations.upsertLabel, {
          label,
        });
        changeCount++;
      }
    }

    // Process items
    if (syncData.items && syncData.items.length > 0) {
      console.log(`Processing ${syncData.items.length} item changes...`);
      for (const item of syncData.items) {
        await ctx.runMutation(internal.todoist.mutations.upsertItem, {
          item,
        });
        changeCount++;
      }
    }

    // Process notes
    if (syncData.notes && syncData.notes.length > 0) {
      console.log(`Processing ${syncData.notes.length} note changes...`);
      for (const note of syncData.notes) {
        await ctx.runMutation(internal.todoist.mutations.upsertNote, {
          note,
        });
        changeCount++;
      }
    }

    // Process reminders
    if (syncData.reminders && syncData.reminders.length > 0) {
      console.log(`Processing ${syncData.reminders.length} reminder changes...`);
      for (const reminder of syncData.reminders) {
        await ctx.runMutation(internal.todoist.mutations.upsertReminder, {
          reminder,
        });
        changeCount++;
      }
    }

    // Update sync token
    await ctx.runMutation(internal.todoist.mutations.updateSyncToken, {
      token: syncData.sync_token,
    });

    console.log(`Incremental sync complete: ${changeCount} changes processed`);

    return {
      changeCount,
      syncToken: syncData.sync_token,
      fullSync: false,
    };
  },
});