import type { FilterBuilder, NamedTableInfo } from "convex/server";

import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

import { soleAccountScope } from "./accounts";
import { handleKey } from "./conversationIdentity";
import { inScope, type AccountScope } from "./messageShape";

type Conversation = Doc<"comma_conversations">;

/*
 * Rows written before accounts have no accountId (old messages no platform either), so each lookup that misses the
 * account-scoped index reads the legacy one and keeps rows in scope. ponytail: drop the legacy reads and their indexes
 * once the accounts backfill has run.
 */

/** The conversation an account knows by this key. */
export async function findByKey(ctx: QueryCtx, scope: AccountScope, key: string): Promise<Conversation | null> {
  if (scope.accountId) {
    const hit = await ctx.db.query("comma_conversations")
      .withIndex("by_platform_account_key", (q) => q.eq("platform", scope.platform).eq("accountId", scope.accountId!).eq("conversationKey", key))
      .unique();
    if (hit) return hit;
  }
  const legacy = await ctx.db.query("comma_conversations")
    .withIndex("by_platform_conversationKey", (q) => q.eq("platform", scope.platform).eq("conversationKey", key)).collect();
  return legacy.find((row) => inScope(row, scope)) ?? null;
}

/** The one-to-one conversation with this handle (a phone number or an email) on an account. */
export async function findByHandle(ctx: QueryCtx, scope: AccountScope, handle: string): Promise<Conversation | null> {
  return await findByKey(ctx, scope, handleKey(handle));
}

/** The alias row for an iMessage chat GUID in this scope. */
export async function findAlias(ctx: QueryCtx, scope: AccountScope, chatGuid: string): Promise<Doc<"comma_chat_aliases"> | null> {
  const rows = await ctx.db.query("comma_chat_aliases").withIndex("by_chatGuid", (q) => q.eq("chatGuid", chatGuid)).collect();
  return rows.find((row) => inScope(row, scope)) ?? null;
}

/** The conversation an iMessage chat GUID belongs to, through its alias. */
export async function findByChatGuid(ctx: QueryCtx, scope: AccountScope, chatGuid: string): Promise<Conversation | null> {
  const alias = await findAlias(ctx, scope, chatGuid);
  return alias ? await ctx.db.get(alias.conversationId) : null;
}

/** A message by its platform id. Every lookup of a message by guid goes through here. */
export async function findMessage(ctx: QueryCtx, scope: AccountScope, guid: string): Promise<Doc<"comma_messages"> | null> {
  if (scope.accountId) {
    const hit = await ctx.db.query("comma_messages")
      .withIndex("by_platform_account_guid", (q) => q.eq("platform", scope.platform).eq("accountId", scope.accountId!).eq("guid", guid))
      .unique();
    if (hit) return hit;
  }
  const legacy = await ctx.db.query("comma_messages").withIndex("by_guid", (q) => q.eq("guid", guid)).collect();
  return legacy.find((row) => inScope(row, scope)) ?? null;
}

/**
 * The query filter for messages a thread shows: not unsent, not associated. Rows from before the side object carry
 * `isTapback`; newer ones `imessage.isAssociatedMessage`; another platform's carry neither.
 */
export function shownInThread(q: FilterBuilder<NamedTableInfo<DataModel, "comma_messages">>) {
  return q.and(q.neq(q.field("isTapback"), true), q.neq(q.field("imessage.isAssociatedMessage"), true), q.eq(q.field("retracted"), false));
}

/** An attachment by its platform id. */
export async function findAttachment(ctx: QueryCtx, scope: AccountScope, guid: string): Promise<Doc<"comma_attachments"> | null> {
  const rows = await ctx.db.query("comma_attachments").withIndex("by_guid", (q) => q.eq("guid", guid)).collect();
  return rows.find((row) => inScope(row, scope)) ?? null;
}

/** Callers that still name a conversation by chat GUID or handle; exactly one field is set. */
export type ConversationRef = { conversationId?: Id<"comma_conversations">; chatGuid?: string; address?: string };

export async function findConversation(ctx: QueryCtx, ref: ConversationRef): Promise<Conversation | null> {
  if ([ref.conversationId, ref.chatGuid, ref.address].filter((x) => x !== undefined).length !== 1) {
    throw new Error("Pass exactly one of conversationId, chatGuid, address");
  }
  if (ref.conversationId) return await ctx.db.get(ref.conversationId);
  const scope = await soleAccountScope(ctx, "imessage");
  if (ref.chatGuid) return await findByChatGuid(ctx, scope, ref.chatGuid);
  return await findByHandle(ctx, scope, ref.address ?? "");
}
