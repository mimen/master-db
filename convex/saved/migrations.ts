import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { internalMutation } from "../_generated/server";

/** One page of moving saved_items.raw into saved_item_raw. Run until isDone. */
export const moveRawOut = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({ moved: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { paginationOpts }) => {
    const { page, isDone, continueCursor } = await ctx.db.query("saved_items").paginate(paginationOpts);
    let moved = 0;
    for (const row of page) {
      if (row.raw === undefined) continue;
      const stored = await ctx.db
        .query("saved_item_raw")
        .withIndex("by_item_id", (q) => q.eq("item_id", row._id))
        .unique();
      if (!stored) await ctx.db.insert("saved_item_raw", { item_id: row._id, raw: row.raw });
      await ctx.db.patch(row._id, { raw: undefined });
      moved += 1;
    }
    return { moved, isDone, continueCursor };
  },
});
