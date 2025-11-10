import { v, Infer } from "convex/values";

/**
 * Todoist Sync API v1 type schemas
 * These match the structure returned by https://api.todoist.com/api/v1/sync
 */

// Due date structure from Sync API
export const syncDueSchema = v.object({
  date: v.string(),
  is_recurring: v.optional(v.boolean()),
  string: v.optional(v.string()),
  lang: v.optional(v.string()), // Language code for date string (webhook only)
  datetime: v.optional(v.string()),
  timezone: v.optional(v.union(v.string(), v.null())),
});

// Deadline schema for non-recurring dates without time
const syncDeadlineSchema = v.object({
  date: v.string(), // YYYY-MM-DD format
  lang: v.string(),
});

// Duration schema for task duration
const syncDurationSchema = v.object({
  amount: v.number(),
  unit: v.string(), // "minute" or "day"
});

// Item (task) structure from Sync API
export const syncItemSchema = v.object({
  id: v.string(),
  content: v.string(),
  description: v.optional(v.string()),
  project_id: v.optional(v.union(v.string(), v.null())),
  section_id: v.optional(v.union(v.string(), v.null())),
  parent_id: v.optional(v.union(v.string(), v.null())),
  child_order: v.optional(v.number()),
  day_order: v.optional(v.number()), // Order within the day (webhook only)
  priority: v.optional(v.number()),
  due: v.optional(v.union(syncDueSchema, v.null())),
  deadline: v.optional(v.union(syncDeadlineSchema, v.null())),
  duration: v.optional(v.union(syncDurationSchema, v.null())),
  labels: v.optional(v.array(v.string())),
  assigned_by_uid: v.optional(v.union(v.string(), v.null())),
  added_by_uid: v.optional(v.union(v.string(), v.null())),
  responsible_uid: v.optional(v.union(v.string(), v.null())),
  comment_count: v.optional(v.number()),
  note_count: v.optional(v.number()), // Alternative field name sometimes used by API
  checked: v.optional(v.union(v.boolean(), v.number())),
  is_deleted: v.optional(v.union(v.boolean(), v.number())),
  is_collapsed: v.optional(v.boolean()), // Whether subtasks are collapsed (webhook only)
  added_at: v.optional(v.union(v.string(), v.null())),
  date_added: v.optional(v.union(v.string(), v.null())),
  completed_at: v.optional(v.union(v.string(), v.null())),
  date_completed: v.optional(v.union(v.string(), v.null())),
  updated_at: v.optional(v.union(v.string(), v.null())),
  user_id: v.optional(v.union(v.string(), v.null())),
  url: v.optional(v.string()), // Direct URL to the task (webhook only)
});

// Project structure from Sync API
export const syncProjectSchema = v.object({
  id: v.string(),
  name: v.string(),
  color: v.optional(v.string()),
  parent_id: v.optional(v.union(v.string(), v.null())),
  child_order: v.optional(v.number()),
  collapsed: v.optional(v.boolean()),
  is_collapsed: v.optional(v.boolean()), // Webhook version of collapsed
  shared: v.optional(v.boolean()),
  is_shared: v.optional(v.boolean()), // Webhook version of shared
  is_deleted: v.optional(v.union(v.boolean(), v.number())),
  is_archived: v.optional(v.union(v.boolean(), v.number())),
  is_favorite: v.optional(v.union(v.boolean(), v.number())),
  is_frozen: v.optional(v.boolean()), // Whether project is frozen (webhook only)
  view_style: v.optional(v.string()),
  created_at: v.optional(v.string()),
  updated_at: v.optional(v.string()),
  description: v.optional(v.string()), // Webhook includes description
  can_assign_tasks: v.optional(v.boolean()), // Webhook only
  creator_uid: v.optional(v.string()), // Webhook only
  default_order: v.optional(v.number()), // Webhook only
  public_access: v.optional(v.boolean()), // Webhook only
  public_key: v.optional(v.string()), // Webhook only
  role: v.optional(v.string()), // User's role in project (webhook only)
  access: v.optional(v.object({ // Webhook only - access control settings
    visibility: v.string(),
    configuration: v.any(),
  })),
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
  added_at: v.optional(v.string()), // Alternative field name sometimes used by API
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
  file_attachment: v.optional(v.union(v.object({
    file_name: v.string(),
    file_size: v.number(),
    file_type: v.string(),
    file_url: v.string(),
    upload_state: v.string(),
  }), v.null())),
  uids_to_notify: v.optional(v.union(v.array(v.string()), v.null())),
  is_deleted: v.optional(v.union(v.boolean(), v.number())),
  posted_at: v.string(),
  reactions: v.optional(v.union(v.record(v.string(), v.array(v.string())), v.null())),
});

// Reminder structure from Sync API
export const syncReminderSchema = v.object({
  id: v.string(),
  notify_uid: v.string(),
  item_id: v.string(),
  service: v.optional(v.string()), // Optional - not always present
  type: v.string(),
  date: v.optional(v.string()),
  due: v.optional(v.union(syncDueSchema, v.null())),
  mm_offset: v.optional(v.number()), // Minutes offset
  minute_offset: v.optional(v.number()), // Alternative field name
  is_deleted: v.optional(v.union(v.boolean(), v.number())),
});

// Type inference helpers for TypeScript
export type SyncDue = Infer<typeof syncDueSchema>;
export type SyncItem = Infer<typeof syncItemSchema>;
export type SyncProject = Infer<typeof syncProjectSchema>;
export type SyncSection = Infer<typeof syncSectionSchema>;
export type SyncLabel = Infer<typeof syncLabelSchema>;
export type SyncNote = Infer<typeof syncNoteSchema>;
export type SyncReminder = Infer<typeof syncReminderSchema>;