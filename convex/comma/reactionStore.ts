import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { CommaReaction, CommaReactionState } from "../schema/comma/validators";

import { currentKey, messageKey, reactionWrites, shownReactions } from "./reactions";

/** Rows written before emoji keys were namespaced read with their current key, and a write converges them. */
async function reactionRows(ctx: QueryCtx, targetKey: string): Promise<Doc<"comma_reactions">[]> {
  const rows = await ctx.db.query("comma_reactions").withIndex("by_targetKey", (q) => q.eq("targetKey", targetKey)).collect();
  return rows.map((row) => ({ ...row, key: currentKey(row.key) }));
}

/** Records one reaction event and the sender's reactions it replaces; see reactionWrites. Returns whether it would write. */
export async function applyReaction(ctx: MutationCtx, event: CommaReactionState, write = true): Promise<boolean> {
  const writes = reactionWrites(await reactionRows(ctx, event.targetKey), event);
  if (!write) return writes.length > 0;
  for (const { row, state } of writes) {
    if (row) await ctx.db.replace(row._id, state);
    else await ctx.db.insert("comma_reactions", state);
  }
  return writes.length > 0;
}

/** A message's reactions, sender names unset. */
export async function reactionsOf(ctx: QueryCtx, message: Pick<Doc<"comma_messages">, "platform" | "guid">): Promise<CommaReaction[]> {
  return shownReactions(await reactionRows(ctx, messageKey(message.platform ?? "imessage", message.guid)));
}
