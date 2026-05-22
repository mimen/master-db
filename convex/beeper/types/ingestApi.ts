import { v } from "convex/values";

/**
 * Validators for payloads coming in over the /beeper/ingest HTTP route.
 *
 * Source-of-truth is the Beeper Desktop local HTTP API (http://localhost:23373/v1).
 * The local sync script reshapes Beeper's camelCase responses into the
 * snake_case payloads defined here before POSTing them to Convex.
 *
 * We accept v.any() for raw blobs (the original Beeper objects). They are
 * stored as JSON.stringify on the row so we can re-derive structured fields
 * later without re-pulling from Beeper.
 */

export const ingestAccountSchema = v.object({
  account_id: v.string(),
  network: v.string(),
  display_name: v.optional(v.string()),
  phone_number: v.optional(v.string()),
  is_active: v.optional(v.boolean()),
  raw: v.optional(v.string()),
});

const participantSchema = v.object({
  id: v.string(),
  phone_number: v.optional(v.string()),
  full_name: v.optional(v.string()),
  is_self: v.optional(v.boolean()),
  is_admin: v.optional(v.boolean()),
  img_url: v.optional(v.string()),
});

export const ingestChatSchema = v.object({
  account_id: v.string(),
  network: v.string(),
  chat_id: v.string(),
  local_chat_id: v.optional(v.string()),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  type: v.string(),
  img_url: v.optional(v.string()),
  participants: v.array(participantSchema),
  last_activity: v.optional(v.string()),
  is_archived: v.optional(v.boolean()),
  is_muted: v.optional(v.boolean()),
  is_pinned: v.optional(v.boolean()),
  is_read_only: v.optional(v.boolean()),
  unread_count: v.optional(v.number()),
  raw: v.optional(v.string()),
});

const reactionSchema = v.object({
  participant_id: v.string(),
  emoji_or_key: v.string(),
});

const attachmentSchema = v.object({
  mxc_id: v.string(),
  type: v.optional(v.string()),
  mime_type: v.optional(v.string()),
  file_name: v.optional(v.string()),
  file_size: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  duration_ms: v.optional(v.number()),
  is_gif: v.optional(v.boolean()),
  is_sticker: v.optional(v.boolean()),
  beeper_src_url: v.optional(v.string()),
  convex_storage_id: v.optional(v.string()),
});

export const ingestMessageSchema = v.object({
  account_id: v.string(),
  network: v.string(),
  chat_id: v.string(),

  message_id: v.string(),
  sort_key: v.optional(v.string()),

  sender_id: v.optional(v.string()),
  sender_name: v.optional(v.string()),
  is_sender: v.optional(v.boolean()),

  timestamp: v.optional(v.string()),

  type: v.optional(v.string()),
  text: v.optional(v.string()),

  reactions: v.optional(v.array(reactionSchema)),
  attachments: v.optional(v.array(attachmentSchema)),

  reply_to_message_id: v.optional(v.string()),
  is_deleted: v.optional(v.boolean()),
  is_hidden: v.optional(v.boolean()),

  raw: v.optional(v.string()),
});
