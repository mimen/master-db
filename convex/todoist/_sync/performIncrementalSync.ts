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
      const syncState = await ctx.runQuery(internal.todoist.internal.queries.getSyncState.getSyncState);
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
        for (const rawProject of syncData.projects) {
          // Extract only the fields we need
          const project = {
            id: rawProject.id,
            name: rawProject.name,
            color: rawProject.color,
            parent_id: rawProject.parent_id,
            child_order: rawProject.child_order,
            collapsed: rawProject.collapsed,
            shared: rawProject.shared,
            is_deleted: rawProject.is_deleted,
            is_archived: rawProject.is_archived,
            is_favorite: rawProject.is_favorite,
            view_style: rawProject.view_style,
          };

          await ctx.runMutation(internal.todoist.mutations.upsertProject, {
            project,
          });
          changeCount++;
        }
      }

      // Process sections
      if (syncData.sections && syncData.sections.length > 0) {
        for (const rawSection of syncData.sections) {
          // Extract only the fields we need
          const section = {
            id: rawSection.id,
            name: rawSection.name,
            project_id: rawSection.project_id,
            section_order: rawSection.section_order,
            collapsed: rawSection.collapsed,
            is_deleted: rawSection.is_deleted,
            is_archived: rawSection.is_archived,
            date_archived: rawSection.date_archived,
            date_added: rawSection.date_added || rawSection.added_at || "",
            user_id: rawSection.user_id,
          };

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
        for (const rawItem of syncData.items) {
          // Extract only the fields we need
          const item = {
            id: rawItem.id,
            content: rawItem.content,
            description: rawItem.description,
            project_id: rawItem.project_id,
            section_id: rawItem.section_id,
            parent_id: rawItem.parent_id,
            child_order: rawItem.child_order,
            priority: rawItem.priority,
            due: rawItem.due ? {
              date: rawItem.due.date,
              is_recurring: rawItem.due.is_recurring,
              string: rawItem.due.string,
              datetime: rawItem.due.datetime,
              timezone: rawItem.due.timezone,
            } : null,
            labels: rawItem.labels,
            assigned_by_uid: rawItem.assigned_by_uid,
            responsible_uid: rawItem.responsible_uid,
            added_by_uid: rawItem.added_by_uid || "",
            comment_count: rawItem.comment_count || rawItem.note_count || 0,
            checked: rawItem.checked,
            is_deleted: rawItem.is_deleted,
            added_at: rawItem.added_at || new Date().toISOString(),
            completed_at: rawItem.completed_at,
            updated_at: rawItem.updated_at || new Date().toISOString(),
            user_id: rawItem.user_id || "",
          };

          await ctx.runMutation(internal.todoist.mutations.upsertItem, {
            item,
            force: true, // Force update during incremental sync to catch assignment changes
          });
          changeCount++;
        }
      }

      // Process notes
      if (syncData.notes && syncData.notes.length > 0) {
        for (const rawNote of syncData.notes) {
          // Extract only the fields we need
          const note = {
            id: rawNote.id,
            posted_uid: rawNote.posted_uid,
            item_id: rawNote.item_id,
            project_id: rawNote.project_id,
            content: rawNote.content,
            file_attachment: rawNote.file_attachment ? {
              file_name: rawNote.file_attachment.file_name,
              file_size: rawNote.file_attachment.file_size,
              file_type: rawNote.file_attachment.file_type,
              file_url: rawNote.file_attachment.file_url,
              upload_state: rawNote.file_attachment.upload_state,
            } : null,
            uids_to_notify: rawNote.uids_to_notify,
            is_deleted: rawNote.is_deleted,
            posted_at: rawNote.posted_at,
            reactions: rawNote.reactions,
          };

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