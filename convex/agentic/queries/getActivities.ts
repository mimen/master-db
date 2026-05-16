import { v } from "convex/values";

import { query } from "../../_generated/server";

export default query({
  args: { run_id: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("agenticThreadActivities")
      .withIndex("by_run_id", (q) => q.eq("run_id", args.run_id))
      .collect(),
});
