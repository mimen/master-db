import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { findConversation } from "../comma/conversationLookup";

/**
 * A group chat's CRM (chat_crm, tags, event_links) belongs to its Comma conversation. Rows written
 * before that carry only `chat_guid`, the conversation's primary chat GUID at the time.
 */
export type GroupRef = { conversationId?: Id<"comma_conversations">; chatGuid?: string };

export async function groupConversation(ctx: QueryCtx, ref: GroupRef): Promise<Doc<"comma_conversations">> {
  const conversation = await findConversation(ctx, ref);
  if (!conversation) throw new Error(`No conversation for ${ref.conversationId ?? ref.chatGuid}`);
  return conversation;
}

/** Fields a new group CRM row carries. */
export function groupOwner(conversation: Doc<"comma_conversations">) {
  return { conversation_id: conversation._id, chat_guid: conversation.primaryChatGuid };
}

// ponytail: each read also takes the chat_guid rows comma/migrations:rekeyGroupCrm has not moved; drop that half once it has run.
async function withUnmoved<T extends { conversation_id?: Id<"comma_conversations"> }>(moved: Promise<T[]>, legacy: Promise<T[]>): Promise<T[]> {
  const [current, old] = await Promise.all([moved, legacy]);
  return [...current, ...old.filter((row) => !row.conversation_id)];
}

/** A group conversation's CRM rows, table by table. */
export const groupCrm = {
  async crm(ctx: QueryCtx, conversation: Doc<"comma_conversations">) {
    const rows = await withUnmoved(
      ctx.db.query("chat_crm").withIndex("by_conversation", (q) => q.eq("conversation_id", conversation._id)).collect(),
      ctx.db.query("chat_crm").withIndex("by_chat_guid", (q) => q.eq("chat_guid", conversation.primaryChatGuid)).collect(),
    );
    return rows[0] ?? null;
  },
  tags: (ctx: QueryCtx, conversation: Doc<"comma_conversations">) => withUnmoved(
    ctx.db.query("tags").withIndex("by_conversation", (q) => q.eq("conversation_id", conversation._id)).collect(),
    ctx.db.query("tags").withIndex("by_chat", (q) => q.eq("chat_guid", conversation.primaryChatGuid)).collect(),
  ),
  events: (ctx: QueryCtx, conversation: Doc<"comma_conversations">) => withUnmoved(
    ctx.db.query("event_links").withIndex("by_conversation", (q) => q.eq("conversation_id", conversation._id)).collect(),
    ctx.db.query("event_links").withIndex("by_chat", (q) => q.eq("chat_guid", conversation.primaryChatGuid)).collect(),
  ),
};
