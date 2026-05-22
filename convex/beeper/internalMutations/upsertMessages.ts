import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";
import { ingestMessageSchema } from "../types/ingestApi";

/**
 * Batch upsert of messages for ONE chat. Keyed by (chat_id, message_id).
 *
 * Versioning: we treat sort_key as the version. Beeper assigns a globally
 * monotonic numeric sort_key per chat; any same-key row coming back from
 * Beeper after we already have it represents either a no-op duplicate or an
 * edit (we accept the latter and overwrite, since attempts at field-level
 * version reasoning would lose reactions/edits).
 *
 * Also bumps `beeper_chats.message_count` to reflect the row count for the
 * chat after the upsert (best-effort cache; not authoritative for analytics).
 */
export const upsertMessages = internalMutation({
  args: {
    chat_id: v.string(),
    messages: v.array(ingestMessageSchema),
  },
  handler: async (ctx, { chat_id, messages }) => {
    const now = new Date().toISOString();
    let inserted = 0;
    let updated = 0;

    for (const msg of messages) {
      if (msg.chat_id !== chat_id) {
        // Caller batches by chat; mismatch is a bug worth surfacing.
        throw new Error(
          `upsertMessages: message ${msg.message_id} has chat_id ${msg.chat_id}, expected ${chat_id}`,
        );
      }

      const existing = await ctx.db
        .query("beeper_messages")
        .withIndex("by_chat_message", (q) =>
          q.eq("chat_id", msg.chat_id).eq("message_id", msg.message_id),
        )
        .first();

      const tsEpoch = msg.timestamp
        ? new Date(msg.timestamp).getTime()
        : undefined;

      const row = {
        account_id: msg.account_id,
        network: msg.network,
        chat_id: msg.chat_id,
        message_id: msg.message_id,
        sort_key: msg.sort_key,
        sender_id: msg.sender_id,
        sender_name: msg.sender_name,
        is_sender: msg.is_sender ?? false,
        timestamp: msg.timestamp,
        ts_epoch_ms: tsEpoch,
        type: msg.type,
        text: msg.text ?? "",
        reactions: msg.reactions ?? [],
        attachments: existing
          ? mergeAttachments(existing.attachments, msg.attachments ?? [])
          : (msg.attachments ?? []),
        reply_to_message_id: msg.reply_to_message_id,
        is_deleted: msg.is_deleted ?? false,
        is_hidden: msg.is_hidden ?? false,
        first_seen_at: existing?.first_seen_at ?? now,
        last_synced_at: now,
        raw: msg.raw,
      };

      if (existing) {
        await ctx.db.patch(existing._id, row);
        updated += 1;
      } else {
        await ctx.db.insert("beeper_messages", row);
        inserted += 1;
      }
    }

    // Update message_count on the chat (best-effort cache).
    const chat = await ctx.db
      .query("beeper_chats")
      .withIndex("by_chat_id", (q) => q.eq("chat_id", chat_id))
      .first();
    if (chat) {
      const all = await ctx.db
        .query("beeper_messages")
        .withIndex("by_chat_recent", (q) => q.eq("chat_id", chat_id))
        .collect();
      await ctx.db.patch(chat._id, {
        message_count: all.length,
        last_synced_at: now,
      });
    }

    return { inserted, updated };
  },
});

/**
 * Preserve `convex_storage_id` that Phase B wrote onto attachments even if
 * Phase A re-ingests the same message later. Match by `mxc_id`.
 */
type Attachment = {
  mxc_id: string;
  type?: string;
  mime_type?: string;
  file_name?: string;
  file_size?: number;
  width?: number;
  height?: number;
  duration_ms?: number;
  is_gif?: boolean;
  is_sticker?: boolean;
  beeper_src_url?: string;
  convex_storage_id?: string;
};

function mergeAttachments(prev: Attachment[], next: Attachment[]): Attachment[] {
  if (!prev.length) return next;
  const prevById = new Map<string, Attachment>();
  for (const a of prev) prevById.set(a.mxc_id, a);
  return next.map((n) => {
    const old = prevById.get(n.mxc_id);
    if (old?.convex_storage_id && !n.convex_storage_id) {
      return { ...n, convex_storage_id: old.convex_storage_id };
    }
    return n;
  });
}
