import { internalMutation } from "../../_generated/server";
import { ingestChatSchema } from "../types/ingestApi";

/**
 * Idempotent upsert of a chat row. Keyed by `chat_id` (Beeper/Matrix room id).
 *
 * Versioning: we don't get a monotonic version field for chats, so we use
 * `last_activity` as the freshness signal. Newer activity always wins; equal
 * activity overwrites (cheap, and covers cases where participant changes
 * happen without a new message).
 */
export const upsertChat = internalMutation({
  args: {
    chat: ingestChatSchema,
  },
  handler: async (ctx, { chat }) => {
    const existing = await ctx.db
      .query("beeper_chats")
      .withIndex("by_chat_id", (q) => q.eq("chat_id", chat.chat_id))
      .first();

    const now = new Date().toISOString();
    const lastActivityEpoch = chat.last_activity
      ? new Date(chat.last_activity).getTime()
      : undefined;

    const row = {
      account_id: chat.account_id,
      network: chat.network,
      chat_id: chat.chat_id,
      local_chat_id: chat.local_chat_id,
      title: chat.title,
      description: chat.description,
      type: chat.type,
      img_url: chat.img_url,
      participants: chat.participants,
      participant_count: chat.participants.length,
      last_activity: chat.last_activity,
      last_activity_epoch_ms: lastActivityEpoch,
      is_archived: chat.is_archived ?? false,
      is_muted: chat.is_muted ?? false,
      is_pinned: chat.is_pinned ?? false,
      is_read_only: chat.is_read_only ?? false,
      unread_count: chat.unread_count ?? 0,
      first_seen_at: existing?.first_seen_at ?? now,
      last_synced_at: now,
      message_count: existing?.message_count ?? 0,
      raw: chat.raw,
    };

    if (existing) {
      await ctx.db.patch(existing._id, row);
      return existing._id;
    }
    return await ctx.db.insert("beeper_chats", row);
  },
});
