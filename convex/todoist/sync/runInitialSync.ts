import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

type SyncResult = {
  changeCount: number;
  syncToken: string;
  fullSync: boolean;
};

export const runInitialSync = action({
  handler: async (ctx): Promise<SyncResult> => {
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
      }
    }

    // Save all sections
    if (syncData.sections) {
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
          date_added: rawSection.date_added || rawSection.added_at,
          user_id: rawSection.user_id,
        };

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
          added_by_uid: rawItem.added_by_uid || "",
          comment_count: rawItem.comment_count,
          checked: rawItem.checked,
          is_deleted: rawItem.is_deleted,
          added_at: rawItem.added_at || new Date().toISOString(),
          completed_at: rawItem.completed_at,
          updated_at: rawItem.updated_at || new Date().toISOString(),
          user_id: rawItem.user_id || "",
        };

        await ctx.runMutation(internal.todoist.mutations.upsertItem, {
          item,
        });
      }
    }

    // Save all notes
    if (syncData.notes) {
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

    const changeCount =
      (syncData.projects?.length || 0) +
      (syncData.sections?.length || 0) +
      (syncData.labels?.length || 0) +
      (syncData.items?.length || 0) +
      (syncData.notes?.length || 0) +
      (syncData.reminders?.length || 0);

    // Trigger metadata extraction if we synced items
    if (syncData.items?.length) {
      await ctx.runMutation(internal.todoist.mutations.triggerMetadataExtraction);
    }

    return {
      changeCount,
      syncToken: syncData.sync_token,
      fullSync: true,
    };
  },
});