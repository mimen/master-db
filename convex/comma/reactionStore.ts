import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { CommaReaction, CommaReactionState } from "../schema/comma/validators";

import { mergeReactions, messageKey, sameReaction, supersedes } from "./reactions";

async function reactionRows(ctx: QueryCtx, targetKey: string): Promise<Doc<"comma_reactions">[]> {
  return await ctx.db.query("comma_reactions").withIndex("by_targetKey", (q) => q.eq("targetKey", targetKey)).collect();
}

/** Records one reaction event unless a newer one already decided its sender and key. Returns whether it would write. */
export async function applyReaction(ctx: MutationCtx, event: CommaReactionState, write = true): Promise<boolean> {
  const current = (await reactionRows(ctx, event.targetKey)).find((row) => sameReaction(row, event));
  if (!supersedes(event, current)) return false;
  if (!write) return true;
  if (current) await ctx.db.replace(current._id, event);
  else await ctx.db.insert("comma_reactions", event);
  return true;
}

/** A message's reactions, sender names unset. */
export async function reactionsOf(ctx: QueryCtx, message: Pick<Doc<"comma_messages">, "platform" | "guid" | "reactions">): Promise<CommaReaction[]> {
  return mergeReactions(message.reactions, await reactionRows(ctx, messageKey(message.platform ?? "imessage", message.guid)));
}
