// SHARED SEQUENCE SPACE: this table and `agenticThreadMessages` share
// a single monotonic `sequence` counter per `entity_ref`. Mutations that
// insert into either table must compute the next sequence by reading the
// max(sequence) across BOTH tables. See convex/agentic/mutations/appendThreadMessage.ts
// for the canonical nextSequence helper (added in a later task).
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const agenticThreadActivities = defineTable({
  entity_ref: v.string(),
  sequence: v.number(),
  run_id: v.string(),
  kind: v.string(),
  name: v.string(),
  input_json: v.any(),
  output_json: v.union(v.any(), v.null()),
  status: v.string(),
  resolved_at: v.union(v.number(), v.null()),
})
  .index("by_entity_ref_and_sequence", ["entity_ref", "sequence"])
  .index("by_run_id", ["run_id"])
  .index("by_run_id_and_status", ["run_id", "status"]);
