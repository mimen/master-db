import type { MutationCtx } from "../_generated/server";
import type { CommaOutboxPayload } from "../schema/comma/validators";

import { refoldTarget } from "./internal";

/** What a confirmed iMessage command changes in Convex that no BlueBubbles event will report. */
export async function applyIMessageResult(ctx: MutationCtx, payload: CommaOutboxPayload): Promise<void> {
  if (payload.kind !== "react" || !payload.remove) return;
  // macOS 15 removes a tapback by deleting its chat.db row; no removal row ever reaches
  // the bridge, so the reaction stayed folded on the target until this drops it here.
  const { messageGuid, reaction } = payload;
  const mine = await ctx.db.query("comma_messages")
    .withIndex("by_tapbackTargetGuid", (q) => q.eq("tapbackTargetGuid", messageGuid)).collect();
  for (const tapback of mine) {
    if (tapback.isFromMe && tapback.tapback?.reaction === reaction && !tapback.tapback.remove) await ctx.db.delete(tapback._id);
  }
  await refoldTarget(ctx, messageGuid);
}
