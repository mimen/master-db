import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

export const runInitialSync = action({
  handler: async (ctx) => {
    const token = process.env.TODOIST_API_TOKEN;
    if (!token) {
      throw new Error("TODOIST_API_TOKEN not configured");
    }

    // Initialize sync state
    await ctx.runMutation(internal.todoist.mutations.initializeSyncState);

    // Perform full sync
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
    
    // Save all projects
    if (syncData.projects) {
      for (const project of syncData.projects) {
        await ctx.runMutation(internal.todoist.mutations.upsertProject, {
          project,
        });
      }
    }

    // Save all sections
    if (syncData.sections) {
      for (const section of syncData.sections) {
        await ctx.runMutation(internal.todoist.mutations.upsertSection, {
          section,
        });
      }
    }

    // Save all labels
    if (syncData.labels) {
      for (const label of syncData.labels) {
        await ctx.runMutation(internal.todoist.mutations.upsertLabel, {
          label,
        });
      }
    }

    // Save all items
    if (syncData.items) {
      for (const item of syncData.items) {
        await ctx.runMutation(internal.todoist.mutations.upsertItem, {
          item,
        });
      }
    }

    // Save all notes
    if (syncData.notes) {
      for (const note of syncData.notes) {
        await ctx.runMutation(internal.todoist.mutations.upsertNote, {
          note,
        });
      }
    }

    // Save all reminders
    if (syncData.reminders) {
      for (const reminder of syncData.reminders) {
        await ctx.runMutation(internal.todoist.mutations.upsertReminder, {
          reminder,
        });
      }
    }

    // Update sync token
    await ctx.runMutation(internal.todoist.mutations.updateSyncToken, {
      token: syncData.sync_token,
    });

    return {
      projects: syncData.projects?.length || 0,
      sections: syncData.sections?.length || 0,
      labels: syncData.labels?.length || 0,
      items: syncData.items?.length || 0,
      notes: syncData.notes?.length || 0,
      reminders: syncData.reminders?.length || 0,
      syncToken: syncData.sync_token,
    };
  },
});