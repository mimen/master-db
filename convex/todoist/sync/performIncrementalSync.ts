import { api, internal } from "../../_generated/api";
import { action } from "../../_generated/server";
import type { SyncItem, SyncProject, SyncSection, SyncLabel, SyncNote, SyncReminder } from "../types/syncApi";

type SyncResult = {
  changeCount: number;
  syncToken: string;
  fullSync: boolean;
};

type SyncResponse = {
  sync_token: string;
  full_sync?: boolean;
  projects?: SyncProject[];
  items?: SyncItem[];
  labels?: SyncLabel[];
  sections?: SyncSection[];
  notes?: SyncNote[];
  reminders?: SyncReminder[];
};

export const performIncrementalSync = action({
  handler: async (ctx): Promise<SyncResult | void> => {
    try {
      const token = process.env.TODOIST_API_TOKEN;
      if (!token) {
        throw new Error("TODOIST_API_TOKEN not configured");
      }

      // Get current sync state
      const syncState = await ctx.runQuery(internal.todoist.queries.getSyncState);
      if (!syncState?.last_sync_token) {
        return ctx.runAction(api.todoist.sync.runInitialSync);
      }

      // Perform incremental sync using API v1
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

      const syncData: SyncResponse = await response.json();

      // Check if this is a full sync
      if (syncData.full_sync) {
        return ctx.runAction(api.todoist.sync.runInitialSync);
      }

      let changeCount = 0;

      // Process projects
      if (syncData.projects && syncData.projects.length > 0) {
        for (const project of syncData.projects) {
          await ctx.runMutation(internal.todoist.mutations.upsertProject, {
            project,
          });
          changeCount++;
        }
      }

      // Process sections
      if (syncData.sections && syncData.sections.length > 0) {
        for (const section of syncData.sections) {
          await ctx.runMutation(internal.todoist.mutations.upsertSection, {
            section,
          });
          changeCount++;
        }
      }

      // Process labels
      if (syncData.labels && syncData.labels.length > 0) {
        for (const label of syncData.labels) {
          await ctx.runMutation(internal.todoist.mutations.upsertLabel, {
            label,
          });
          changeCount++;
        }
      }

      // Process items
      if (syncData.items && syncData.items.length > 0) {
        for (const item of syncData.items) {
          await ctx.runMutation(internal.todoist.mutations.upsertItem, {
            item,
          });
          changeCount++;
        }
      }

      // Process notes
      if (syncData.notes && syncData.notes.length > 0) {
        for (const note of syncData.notes) {
          await ctx.runMutation(internal.todoist.mutations.upsertNote, {
            note,
          });
          changeCount++;
        }
      }

      // Process reminders
      if (syncData.reminders && syncData.reminders.length > 0) {
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

      // Trigger metadata extraction if we synced items
      if (syncData.items && syncData.items.length > 0) {
        await ctx.runMutation(internal.todoist.mutations.triggerMetadataExtraction);
      }

      return {
        changeCount,
        syncToken: syncData.sync_token,
        fullSync: false,
      };
    } catch (error) {
      console.error("Sync failed:", error);
      throw error;
    }
  },
});