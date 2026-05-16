// SHARED SEQUENCE SPACE: this table and `agenticThreadActivities` share
// a single monotonic `sequence` counter per `entity_ref`. Mutations that
// insert into either table must compute the next sequence by reading the
// max(sequence) across BOTH tables. See convex/agentic/mutations/recordActivity.ts
// for the canonical nextSequence helper (added in a later task).
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const agenticThreadMessages = defineTable({
  entity_ref: v.string(),
  sequence: v.number(),
  run_id: v.string(),
  kind: v.string(),
  body_markdown: v.union(v.string(), v.null()),
  proposal_json: v.union(v.any(), v.null()),
  error_json: v.union(v.any(), v.null()),
  token_usage: v.union(v.any(), v.null()),
  checkpoint_id: v.union(v.string(), v.null()),
})
  .index("by_entity_ref_and_sequence", ["entity_ref", "sequence"])
  .index("by_run_id", ["run_id"])
  .index("by_checkpoint_id", ["checkpoint_id"]);
