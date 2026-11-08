import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { primaryChat } from "../comma/conversationIdentity";
import { findConversation } from "../comma/conversationLookup";

/** A group chat's CRM (chat_crm, tags, event_links) belongs to its Comma conversation. */
export type GroupRef = { conversationId?: Id<"comma_conversations">; chatGuid?: string };

export async function groupConversation(ctx: QueryCtx, ref: GroupRef): Promise<Doc<"comma_conversations">> {
  const conversation = await findConversation(ctx, ref);
  if (!conversation) throw new Error(`No conversation for ${ref.conversationId ?? ref.chatGuid}`);
  return conversation;
}

/** Fields a new group CRM row carries. */
export function groupOwner(conversation: Doc<"comma_conversations">) {
  return { conversation_id: conversation._id, chat_guid: primaryChat(conversation) };
}

/** A group conversation's CRM rows, table by table. */
export const groupCrm = {
  async crm(ctx: QueryCtx, conversation: Doc<"comma_conversations">) {
    return await ctx.db.query("chat_crm").withIndex("by_conversation", (q) => q.eq("conversation_id", conversation._id)).first();
  },
  tags: (ctx: QueryCtx, conversation: Doc<"comma_conversations">) =>
    ctx.db.query("tags").withIndex("by_conversation", (q) => q.eq("conversation_id", conversation._id)).collect(),
  events: (ctx: QueryCtx, conversation: Doc<"comma_conversations">) =>
    ctx.db.query("event_links").withIndex("by_conversation", (q) => q.eq("conversation_id", conversation._id)).collect(),
};
