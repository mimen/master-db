import type { Doc } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import type { CommandResult, CommaOutboxLane, CommaPlatform } from "../schema/comma/validators";

import { applyIMessageResult } from "./imessageResults";

type OutboxRow = Doc<"comma_outbox">;

/**
 * Who runs a lane's commands. A pull lane waits for an outside executor to claim its rows (the Mini, for iMessage);
 * a convex lane runs each row in a Convex action, scheduled at enqueue. Both share the claim token, lease and receipt.
 */
export type LaneSpec = {
  lane: CommaOutboxLane;
  /** What a confirmed command changes in Convex that no platform event will report. */
  onResult?: (ctx: MutationCtx, row: OutboxRow) => Promise<void>;
} & ({ executor: "pull" } | { executor: "convex"; execute: (ctx: ActionCtx, row: OutboxRow) => Promise<CommandResult> });

export const PLATFORM_LANES: Record<CommaPlatform, LaneSpec> = {
  imessage: { lane: "imessage", executor: "pull", onResult: applyIMessageResult },
};

/** Model work, whatever the conversation's platform. The Mini's AI process claims it. */
export const AI_LANE: LaneSpec = { lane: "ai", executor: "pull" };
/** Model work nobody is waiting on; the AI process drains it beside the ai lane. */
export const AI_BACKGROUND_LANE: LaneSpec = { lane: "aiBackground", executor: "pull" };
