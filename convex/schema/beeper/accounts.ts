import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * One row per connected Beeper account / network bridge.
 *
 * `account_id` is Beeper's internal account identifier (e.g. "whatsapp",
 * "telegram", or per-instance ids like "slackgo.T066U9Q8F99-U066UCP4FS6").
 *
 * `network` is the human-readable network name returned by Beeper
 * ("WhatsApp", "Telegram", "Slack", "Google Messages", "iMessage", "Matrix").
 */
export const beeper_accounts = defineTable({
  account_id: v.string(),
  network: v.string(),
  display_name: v.optional(v.string()),
  phone_number: v.optional(v.string()),
  is_active: v.boolean(),
  last_full_sync_at: v.optional(v.string()),
  last_incremental_sync_at: v.optional(v.string()),
  raw: v.optional(v.string()),
})
  .index("by_account_id", ["account_id"])
  .index("by_network", ["network"]);
