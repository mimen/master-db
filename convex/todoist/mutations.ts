import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const initializeSyncState = internalMutation({
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("sync_state")
      .withIndex("by_service", (q) => q.eq("service", "todoist"))
      .first();

    if (!existing) {
      await ctx.db.insert("sync_state", {
        service: "todoist",
        last_sync_token: undefined,
        last_full_sync: new Date().toISOString(),
      });
    }
  },
});

export const upsertProject = internalMutation({
  args: { project: v.any() },
  handler: async (ctx, { project }) => {
    const existing = await ctx.db
      .query("todoist_projects")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", project.id))
      .first();

    // Use updated_at as version since Sync API v1 doesn't provide version field
    const currentVersion = project.updated_at ? new Date(project.updated_at).getTime() : Date.now();

    const projectData = {
      todoist_id: project.id,
      name: project.name,
      color: project.color,
      parent_id: project.parent_id || undefined,
      child_order: project.child_order || 0,
      is_deleted: project.is_deleted ? 1 : 0,
      is_archived: project.is_archived ? 1 : 0,
      is_favorite: project.is_favorite ? 1 : 0,
      view_style: project.view_style || "list",
      sync_version: currentVersion,
    };

    if (existing) {
      if (existing.sync_version < projectData.sync_version) {
        await ctx.db.patch(existing._id, projectData);
      }
    } else {
      await ctx.db.insert("todoist_projects", projectData);
    }
  },
});

export const upsertItem = internalMutation({
  args: { item: v.any() },
  handler: async (ctx, { item }) => {
    const existing = await ctx.db
      .query("todoist_items")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", item.id))
      .first();

    // Use updated_at as version since Sync API v1 doesn't provide version field
    const currentVersion = item.updated_at ? new Date(item.updated_at).getTime() : Date.now();
    
    const itemData = {
      todoist_id: item.id,
      content: item.content,
      description: item.description || undefined,
      project_id: item.project_id || undefined,
      section_id: item.section_id || undefined,
      parent_id: item.parent_id || undefined,
      child_order: item.child_order || 0,
      priority: item.priority || 1,
      due: item.due || undefined,
      labels: item.labels || [],
      assignee_id: item.assigned_by_uid || undefined,
      assigner_id: item.added_by_uid || undefined,
      comment_count: item.comment_count || 0,
      checked: typeof item.checked === 'boolean' ? (item.checked ? 1 : 0) : (item.checked || 0),
      is_deleted: item.is_deleted ? 1 : 0,
      added_at: item.added_at || new Date().toISOString(),
      completed_at: item.completed_at || undefined,
      user_id: item.user_id || "",
      sync_version: currentVersion,
    };

    if (existing) {
      if (existing.sync_version < itemData.sync_version) {
        await ctx.db.patch(existing._id, itemData);
      }
    } else {
      await ctx.db.insert("todoist_items", itemData);
    }
  },
});

export const upsertSection = internalMutation({
  args: { section: v.any() },
  handler: async (ctx, { section }) => {
    const existing = await ctx.db
      .query("todoist_sections")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", section.id))
      .first();

    // Use a combination of fields as version since Sync API v1 doesn't provide version field
    const currentVersion = Date.now();

    const sectionData = {
      todoist_id: section.id,
      name: section.name,
      project_id: section.project_id,
      section_order: section.section_order || 0,
      is_deleted: section.is_deleted ? 1 : 0,
      is_archived: section.is_archived ? 1 : 0,
      sync_version: currentVersion,
    };

    if (existing) {
      if (existing.sync_version < sectionData.sync_version) {
        await ctx.db.patch(existing._id, sectionData);
      }
    } else {
      await ctx.db.insert("todoist_sections", sectionData);
    }
  },
});

export const upsertLabel = internalMutation({
  args: { label: v.any() },
  handler: async (ctx, { label }) => {
    const existing = await ctx.db
      .query("todoist_labels")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", label.id))
      .first();

    // Use timestamp as version since Sync API v1 doesn't provide version field
    const currentVersion = Date.now();

    const labelData = {
      todoist_id: label.id,
      name: label.name,
      color: label.color,
      item_order: label.item_order || 0,
      is_deleted: label.is_deleted ? 1 : 0,
      is_favorite: label.is_favorite ? 1 : 0,
      sync_version: currentVersion,
    };

    if (existing) {
      if (existing.sync_version < labelData.sync_version) {
        await ctx.db.patch(existing._id, labelData);
      }
    } else {
      await ctx.db.insert("todoist_labels", labelData);
    }
  },
});

export const upsertNote = internalMutation({
  args: { note: v.any() },
  handler: async (ctx, { note }) => {
    const existing = await ctx.db
      .query("todoist_notes")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", note.id))
      .first();

    const noteData = {
      todoist_id: note.id,
      item_id: note.item_id,
      project_id: note.project_id || undefined,
      content: note.content,
      posted_uid: note.posted_uid,
      is_deleted: note.is_deleted ? 1 : 0,
      posted_at: note.posted_at || note.posted || new Date().toISOString(),
      sync_version: note.v || 0,
    };

    if (existing) {
      if (existing.sync_version < noteData.sync_version) {
        await ctx.db.patch(existing._id, noteData);
      }
    } else {
      await ctx.db.insert("todoist_notes", noteData);
    }
  },
});

export const upsertReminder = internalMutation({
  args: { reminder: v.any() },
  handler: async (ctx, { reminder }) => {
    const existing = await ctx.db
      .query("todoist_reminders")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", reminder.id))
      .first();

    const reminderData = {
      todoist_id: reminder.id,
      item_id: reminder.item_id,
      type: reminder.type,
      due: reminder.due,
      mm_offset: reminder.mm_offset || undefined,
      is_deleted: reminder.is_deleted ? 1 : 0,
      sync_version: reminder.v || 0,
    };

    if (existing) {
      if (existing.sync_version < reminderData.sync_version) {
        await ctx.db.patch(existing._id, reminderData);
      }
    } else {
      await ctx.db.insert("todoist_reminders", reminderData);
    }
  },
});

export const updateSyncToken = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const syncState = await ctx.db
      .query("sync_state")
      .withIndex("by_service", (q) => q.eq("service", "todoist"))
      .first();

    if (syncState) {
      await ctx.db.patch(syncState._id, {
        last_sync_token: token,
        last_incremental_sync: new Date().toISOString(),
      });
    }
  },
});