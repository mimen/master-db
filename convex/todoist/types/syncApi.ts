import { v } from "convex/values";

/**
 * Todoist Sync API v1 type schemas
 * These match the structure returned by https://api.todoist.com/api/v1/sync
 */

// Due date structure from Sync API
export const syncDueSchema = v.object({
  date: v.string(),
  is_recurring: v.optional(v.boolean()),
  string: v.optional(v.string()),
  datetime: v.optional(v.string()),
  timezone: v.optional(v.string()),
});

// Item (task) structure from Sync API
export const syncItemSchema = v.object({
  id: v.string(),
  content: v.string(),
  description: v.optional(v.string()),
  project_id: v.optional(v.string()),
  section_id: v.optional(v.string()),
  parent_id: v.optional(v.string()),
  child_order: v.optional(v.number()),
  priority: v.optional(v.number()),
  due: v.optional(syncDueSchema),
  labels: v.optional(v.array(v.string())),
  assigned_by_uid: v.optional(v.string()),
  added_by_uid: v.optional(v.string()),
  comment_count: v.optional(v.number()),
  checked: v.optional(v.union(v.boolean(), v.number())),
  is_deleted: v.optional(v.union(v.boolean(), v.number())),
  added_at: v.optional(v.string()),
  completed_at: v.optional(v.string()),
  updated_at: v.optional(v.string()),
  user_id: v.optional(v.string()),
});

// Project structure from Sync API
export const syncProjectSchema = v.object({
  id: v.string(),
  name: v.string(),
  color: v.optional(v.string()),
  parent_id: v.optional(v.string()),
  child_order: v.optional(v.number()),
  collapsed: v.optional(v.boolean()),
  shared: v.optional(v.boolean()),
  is_deleted: v.optional(v.union(v.boolean(), v.number())),
  is_archived: v.optional(v.union(v.boolean(), v.number())),
  is_favorite: v.optional(v.union(v.boolean(), v.number())),
  view_style: v.optional(v.string()),
});

// Section structure from Sync API
export const syncSectionSchema = v.object({
  id: v.string(),
  name: v.string(),
  project_id: v.string(),
  section_order: v.optional(v.number()),
  collapsed: v.optional(v.boolean()),
  is_deleted: v.optional(v.union(v.boolean(), v.number())),
  is_archived: v.optional(v.union(v.boolean(), v.number())),
  date_archived: v.optional(v.string()),
  date_added: v.optional(v.string()),
  user_id: v.optional(v.string()),
});

// Label structure from Sync API
export const syncLabelSchema = v.object({
  id: v.string(),
  name: v.string(),
  color: v.optional(v.string()),
  item_order: v.optional(v.number()),
  is_deleted: v.optional(v.union(v.boolean(), v.number())),
  is_favorite: v.optional(v.union(v.boolean(), v.number())),
});

// Note (comment) structure from Sync API
export const syncNoteSchema = v.object({
  id: v.string(),
  posted_uid: v.string(),
  item_id: v.string(),
  project_id: v.optional(v.string()),
  content: v.string(),
  file_attachment: v.optional(v.object({
    file_name: v.string(),
    file_size: v.number(),
    file_type: v.string(),
    file_url: v.string(),
    upload_state: v.string(),
  })),
  uids_to_notify: v.optional(v.array(v.string())),
  is_deleted: v.optional(v.union(v.boolean(), v.number())),
  posted_at: v.string(),
  reactions: v.optional(v.record(v.string(), v.array(v.string()))),
});

// Reminder structure from Sync API
export const syncReminderSchema = v.object({
  id: v.string(),
  notify_uid: v.string(),
  item_id: v.string(),
  service: v.string(),
  type: v.string(),
  date: v.optional(v.string()),
  due: v.optional(syncDueSchema),
  mm_offset: v.optional(v.number()),
  is_deleted: v.optional(v.union(v.boolean(), v.number())),
});

// Type inference helpers for TypeScript
export type SyncDue = v.InferInput<typeof syncDueSchema>;
export type SyncItem = v.InferInput<typeof syncItemSchema>;
export type SyncProject = v.InferInput<typeof syncProjectSchema>;
export type SyncSection = v.InferInput<typeof syncSectionSchema>;
export type SyncLabel = v.InferInput<typeof syncLabelSchema>;
export type SyncNote = v.InferInput<typeof syncNoteSchema>;
export type SyncReminder = v.InferInput<typeof syncReminderSchema>;