import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * One row per chat across all Beeper networks.
 *
 * Identity is the Beeper/Matrix room id in `chat_id`. We additionally store the
 * network-side native id in `local_chat_id` (e.g. WhatsApp's numeric internal id)
 * for forensic lookups.
 *
 * `participants` is denormalised JSON because Beeper returns nested objects
 * with mutable fields (avatars, "isAdmin", etc.) we don't want to model fully.
 * The raw chat blob is preserved in `raw` so a future migration can re-derive
 * structured fields without re-ingesting from Beeper.
 */
const participantSchema = v.object({
  id: v.string(),
  phone_number: v.optional(v.string()),
  full_name: v.optional(v.string()),
  is_self: v.optional(v.boolean()),
  is_admin: v.optional(v.boolean()),
  img_url: v.optional(v.string()),
});

export const beeper_chats = defineTable({
  account_id: v.string(),
  network: v.string(),

  chat_id: v.string(),           // Beeper/Matrix room id (globally unique)
  local_chat_id: v.optional(v.string()),

  title: v.optional(v.string()),
  description: v.optional(v.string()),
  type: v.string(),              // "single" | "group" | other
  img_url: v.optional(v.string()),

  participants: v.array(participantSchema),
  participant_count: v.number(),

  last_activity: v.optional(v.string()),       // ISO timestamp
  last_activity_epoch_ms: v.optional(v.number()),

  is_archived: v.boolean(),
  is_muted: v.boolean(),
  is_pinned: v.boolean(),
  is_read_only: v.boolean(),
  unread_count: v.number(),

  first_seen_at: v.string(),                   // when we first synced it
  last_synced_at: v.string(),
  message_count: v.number(),                   // best-effort, updated on backfill

  raw: v.optional(v.string()),                 // JSON.stringify of original chat blob
})
  .index("by_chat_id", ["chat_id"])
  .index("by_account", ["account_id"])
  .index("by_network", ["network"])
  .index("by_network_activity", ["network", "last_activity_epoch_ms"])
  .index("by_last_activity", ["last_activity_epoch_ms"]);
