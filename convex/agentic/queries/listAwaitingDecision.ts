import { v } from "convex/values"

import type { Doc } from "../../_generated/dataModel"
import { authedQuery } from "../../_lib/authed"

import { enrichQueueRun } from "./_enrichQueueRun"

export default authedQuery({
  args: {
    statuses: v.optional(v.array(v.string())),
    sort: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const statuses = args.statuses ?? ["awaiting_decision"]
    const limit = Math.min(args.limit ?? 200, 500)
    const sort = args.sort ?? "urgency"

    // Pick the index that matches the candidate set so .take(limit) keeps
    // the right rows. urgency → by_status_and_urgency desc (verified: numbers
    // descending first, then null/undefined last). recent/oldest →
    // by_status_and_updated_at.
    const allRows: Array<Doc<"agenticRuns">> = []
    for (const status of statuses) {
      const slice =
        sort === "urgency"
          ? await ctx.db
              .query("agenticRuns")
              .withIndex("by_status_and_urgency", (q) => q.eq("status", status))
              .order("desc")
              .take(limit)
          : await ctx.db
              .query("agenticRuns")
              .withIndex("by_status_and_updated_at", (q) => q.eq("status", status))
              .order(sort === "oldest" ? "asc" : "desc")
              .take(limit)
      allRows.push(...slice)
    }

    const enriched = await Promise.all(
      allRows.map((run) => enrichQueueRun(ctx, run)),
    )

    const sorted = enriched.sort((a, b) => {
      const au = a.updated_at
      const bu = b.updated_at
      if (sort === "oldest") return au - bu
      if (sort === "recent") return bu - au
      const aurg = a.last_urgency
      const burg = b.last_urgency
      const aNull = aurg == null
      const bNull = burg == null
      if (aNull && bNull) return bu - au
      if (aNull) return 1
      if (bNull) return -1
      if (aurg !== burg) return burg - aurg
      return bu - au
    })

    return sorted.slice(0, limit)
  },
})
