import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * One row per *unique media file* across all chats / networks. Keyed by
 * `mxc_id` (Beeper's Matrix media identifier — globally unique and stable
 * across messages that share an attachment, e.g. forwards).
 *
 * `convex_storage_id` is the result of `ctx.storage.store(...)` after we
 * upload the file bytes; it is the only way to retrieve the file URL later
 * via `ctx.storage.getUrl(convex_storage_id)`.
 *
 * Phase B does NOT patch `messages.attachments[].convex_storage_id` — that
 * field was reserved in Phase A but we deliberately keep storage IDs only
 * here, so the messages table is immutable post-ingest and there is one
 * source of truth for "where are the bytes." Lookups join through this table.
 */
export const beeper_attachments = defineTable({
  mxc_id: v.string(),
  convex_storage_id: v.string(),
  network: v.string(),
  mime_type: v.optional(v.string()),
  file_name: v.optional(v.string()),
  file_size: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  duration_ms: v.optional(v.number()),
  uploaded_at: v.string(),
}).index("by_mxc_id", ["mxc_id"]);
