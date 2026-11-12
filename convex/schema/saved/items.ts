import { defineTable } from "convex/server";
import { v } from "convex/values";

export const savedPlatform = v.union(v.literal("x"), v.literal("instagram"));

export const savedStatus = v.union(
  v.literal("new"),
  v.literal("kept"),
  v.literal("done"),
  v.literal("dropped"),
);

export const savedSuggestion = v.union(
  v.literal("read later"),
  v.literal("try this tool"),
  v.literal("add to a project"),
  v.literal("drop"),
);

export const savedMedia = v.object({
  type: v.union(v.literal("image"), v.literal("video")),
  url: v.string(),
  storage_id: v.optional(v.id("_storage")),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
});

/**
 * One saved post from any platform, keyed by (platform, platform_id). Rows are
 * never deleted for platform state: un-saving on X or Instagram leaves the
 * backup row in place. Importers insert oldest-saved first, so _creationTime
 * desc is newest-saved first.
 */
export const saved_items = defineTable({
  platform: savedPlatform,
  platform_id: v.string(),
  url: v.string(),
  author: v.optional(v.string()),
  text: v.optional(v.string()),
  posted_at: v.optional(v.string()),
  saved_at: v.string(),
  links: v.array(v.string()),
  media: v.array(savedMedia),
  collections: v.array(v.string()),
  raw: v.optional(v.string()),
  status: savedStatus,
  summary: v.optional(v.string()),
  tags: v.array(v.string()),
  suggestion: v.optional(savedSuggestion),
  notes: v.optional(v.string()),
  processed_at: v.optional(v.string()),
  triaged_at: v.optional(v.string()),
})
  .index("by_platform_and_platform_id", ["platform", "platform_id"])
  .index("by_status", ["status"])
  .index("by_status_and_triaged_at", ["status", "triaged_at"]);

/**
 * The platform's JSON for one saved item, kept apart because it runs to tens of
 * KB per Instagram post and every inbox read would otherwise pull it.
 */
export const saved_item_raw = defineTable({
  item_id: v.id("saved_items"),
  raw: v.string(),
}).index("by_item_id", ["item_id"]);
