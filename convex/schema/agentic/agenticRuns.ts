import { defineTable } from "convex/server";
import { v } from "convex/values";

export const agenticRuns = defineTable({
  entity_ref: v.string(),
  entity_type: v.string(),
  entity_id: v.string(),
  backend: v.string(),
  // resume_cursor is opaque to Convex/the server: each AgentRunner adapter
  // owns the shape. Claude SDK: { session_id, resume_at, turn_count,
  // checkpoint_id }. Codex/API adapters may store different shapes.
  resume_cursor: v.union(v.any(), v.null()),
  status: v.string(),
  last_message_id: v.union(v.id("agenticThreadMessages"), v.null()),
  last_run_id: v.union(v.string(), v.null()),
  last_traceparent: v.union(v.string(), v.null()),
  updated_at: v.number(),
})
  .index("by_entity_ref", ["entity_ref"])
  .index("by_entity_type", ["entity_type"])
  .index("by_status_and_updated_at", ["status", "updated_at"]);
