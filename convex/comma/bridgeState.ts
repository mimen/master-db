import { v } from "convex/values";

import { query, type MutationCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { bridgeStateFields } from "../schema/comma/validators";

export const bridgeStateValue = v.object(bridgeStateFields);
export type BridgeState = typeof bridgeStateValue.type;

export async function publishBridgeState(ctx: MutationCtx, state: BridgeState): Promise<void> {
  const existing = await ctx.db.query("comma_bridge_state").withIndex("by_key", (q) => q.eq("key", "mini")).unique();
  if (existing && existing.lastSeenAt > state.lastSeenAt) return;
  if (existing) await ctx.db.replace(existing._id, state);
  else await ctx.db.insert("comma_bridge_state", state);
}

export const bridgeState = query({
  args: {},
  returns: v.union(bridgeStateValue, v.null()),
  handler: async (ctx) => {
    await assertAllowed(ctx);
    const row = await ctx.db.query("comma_bridge_state").withIndex("by_key", (q) => q.eq("key", "mini")).unique();
    if (!row) return null;
    const { _id: _id, _creationTime: _creationTime, ...state } = row;
    return state;
  },
});
