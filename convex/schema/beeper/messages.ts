import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * One row per Beeper message. Identity = (chat_id, message_id) because
 * Beeper's per-message numeric id is only unique inside a chat.
 *
 * `attachments` is JSON because the schema varies by media type and we want
 * the Phase-B uploader to be able to enrich rows in place by adding
 * convex_storage_id without changing the row's shape from the writer's POV.
 *
 * `sort_key` is Beeper's monotonic per-chat sort key (string of digits in
 * practice; we compare lexicographically when lengths are equal, so we also
 * store ts_epoch_ms for cross-chat range queries / sorting).
 *
 * `text` is mirrored at the top level (not inside `raw`) so the search index
 * can be defined over it.
 */
const reactionSchema = v.object({
  participant_id: v.string(),
  emoji_or_key: v.string(),
});

const attachmentSchema = v.object({
  mxc_id: v.string(),               // mxc://... — primary key for dedupe in Phase B
  type: v.optional(v.string()),     // img | video | audio | file | sticker | gif
  mime_type: v.optional(v.string()),
  file_name: v.optional(v.string()),
  file_size: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  duration_ms: v.optional(v.number()),
  is_gif: v.optional(v.boolean()),
  is_sticker: v.optional(v.boolean()),
  beeper_src_url: v.optional(v.string()),    // file:// path inside Beeper's media cache at ingest time
  convex_storage_id: v.optional(v.string()), // populated by Phase B
});

export const beeper_messages = defineTable({
  account_id: v.string(),
  network: v.string(),
  chat_id: v.string(),

  message_id: v.string(),
  sort_key: v.optional(v.string()),

  sender_id: v.optional(v.string()),
  sender_name: v.optional(v.string()),
  is_sender: v.boolean(),

  timestamp: v.optional(v.string()),     // ISO
  ts_epoch_ms: v.optional(v.number()),

  type: v.optional(v.string()),          // TEXT | IMAGE | VIDEO | FILE | VOICE | LOCATION | REACTION | NOTICE | ...
  text: v.string(),                      // empty string for media-only messages

  reactions: v.array(reactionSchema),
  attachments: v.array(attachmentSchema),

  reply_to_message_id: v.optional(v.string()),  // for REACTION + reply messages
  is_deleted: v.boolean(),
  is_hidden: v.boolean(),

  first_seen_at: v.string(),
  last_synced_at: v.string(),

  raw: v.optional(v.string()),           // JSON.stringify of original message blob
})
  .index("by_chat_message", ["chat_id", "message_id"])
  .index("by_chat_recent", ["chat_id", "ts_epoch_ms"])
  .index("by_network_recent", ["network", "ts_epoch_ms"])
  .index("by_sender", ["sender_id"])
  .searchIndex("search_text", {
    searchField: "text",
    filterFields: ["chat_id", "network", "sender_id", "is_sender", "type"],
  });
