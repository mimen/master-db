import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { CommaPlatform } from "../schema/comma/validators";

import { handleKey } from "./conversationIdentity";

type Conversation = Doc<"comma_conversations">;

/** The conversation a platform knows by this key. */
export async function findByKey(ctx: QueryCtx, platform: CommaPlatform, key: string): Promise<Conversation | null> {
  return await ctx.db.query("comma_conversations")
    .withIndex("by_platform_conversationKey", (q) => q.eq("platform", platform).eq("conversationKey", key)).unique();
}

/** The one-to-one conversation with this handle (a phone number or an email) on a platform. */
export async function findByHandle(ctx: QueryCtx, platform: CommaPlatform, handle: string): Promise<Conversation | null> {
  return await findByKey(ctx, platform, handleKey(handle));
}

/** The conversation an iMessage chat GUID belongs to, through its alias. */
export async function findByChatGuid(ctx: QueryCtx, chatGuid: string): Promise<Conversation | null> {
  const alias = await ctx.db.query("comma_chat_aliases")
    .withIndex("by_chatGuid", (q) => q.eq("chatGuid", chatGuid)).unique();
  return alias ? await ctx.db.get(alias.conversationId) : null;
}

/** Callers that still name a conversation by chat GUID or handle; exactly one field is set. */
export type ConversationRef = { conversationId?: Id<"comma_conversations">; chatGuid?: string; address?: string };

export async function findConversation(ctx: QueryCtx, ref: ConversationRef): Promise<Conversation | null> {
  if ([ref.conversationId, ref.chatGuid, ref.address].filter((x) => x !== undefined).length !== 1) {
    throw new Error("Pass exactly one of conversationId, chatGuid, address");
  }
  if (ref.conversationId) return await ctx.db.get(ref.conversationId);
  if (ref.chatGuid) return await findByChatGuid(ctx, ref.chatGuid);
  return await findByHandle(ctx, "imessage", ref.address ?? "");
}
