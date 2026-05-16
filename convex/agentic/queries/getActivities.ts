import { v } from "convex/values";

import { authedQuery } from "../../_lib/authed";

export default authedQuery({
  args: { run_id: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("agenticThreadActivities")
      .withIndex("by_run_id", (q) => q.eq("run_id", args.run_id))
      .collect(),
});
