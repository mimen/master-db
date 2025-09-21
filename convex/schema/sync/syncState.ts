import { defineTable } from "convex/server";
import { v } from "convex/values";

export const sync_state = defineTable({
  service: v.string(),
  last_sync_token: v.optional(v.string()),
  last_full_sync: v.string(),
  last_incremental_sync: v.optional(v.string()),
}).index("by_service", ["service"]);