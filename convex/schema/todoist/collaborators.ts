import { defineTable } from "convex/server";
import { v } from "convex/values";

export const todoist_collaborators = defineTable({
  todoist_id: v.string(),
  email: v.string(),
  full_name: v.string(),
  avatar_medium: v.optional(v.string()),
  avatar_s60: v.optional(v.string()),
  avatar_big: v.optional(v.string()),
  avatar_small: v.optional(v.string()),
  is_deleted: v.number(),
  sync_version: v.number(),
})
  .index("by_todoist_id", ["todoist_id"])
  .index("by_email", ["email"]);