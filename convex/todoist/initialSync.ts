import { action } from "../_generated/server";
import { internal } from "../_generated/api";

export const runInitialSync = action({
  handler: async (ctx) => {
    console.log("Starting initial Todoist sync...");
    
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

    // Store projects
    if (syncData.projects) {
      console.log(`Syncing ${syncData.projects.length} projects...`);
      for (const project of syncData.projects) {
        await ctx.runMutation(internal.todoist.mutations.upsertProject, {
          project,
        });
      }
    }

    // Store sections
    if (syncData.sections) {
      console.log(`Syncing ${syncData.sections.length} sections...`);
      for (const section of syncData.sections) {
        await ctx.runMutation(internal.todoist.mutations.upsertSection, {
          section,
        });
      }
    }

    // Store labels
    if (syncData.labels) {
      console.log(`Syncing ${syncData.labels.length} labels...`);
      for (const label of syncData.labels) {
        await ctx.runMutation(internal.todoist.mutations.upsertLabel, {
          label,
        });
      }
    }

    // Store items
    if (syncData.items) {
      console.log(`Syncing ${syncData.items.length} items...`);
      for (const item of syncData.items) {
        await ctx.runMutation(internal.todoist.mutations.upsertItem, {
          item,
        });
      }
    }

    // Store notes
    if (syncData.notes) {
      console.log(`Syncing ${syncData.notes.length} notes...`);
      for (const note of syncData.notes) {
        await ctx.runMutation(internal.todoist.mutations.upsertNote, {
          note,
        });
      }
    }

    // Store reminders
    if (syncData.reminders) {
      console.log(`Syncing ${syncData.reminders.length} reminders...`);
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
      projectsCount: syncData.projects?.length || 0,
      itemsCount: syncData.items?.length || 0,
      sectionsCount: syncData.sections?.length || 0,
      labelsCount: syncData.labels?.length || 0,
      notesCount: syncData.notes?.length || 0,
      remindersCount: syncData.reminders?.length || 0,
      syncToken: syncData.sync_token,
    };
  },
});