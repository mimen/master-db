import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { internalAction, type MutationCtx } from "../_generated/server";
import { isAiKind, outboxLane, type CommandResult, type CommaOutboxLane, type CommaOutboxPayload, type CommaPlatform } from "../schema/comma/validators";

import { AI_BACKGROUND_LANE, AI_LANE, NotSentError, PLATFORM_LANES, type LaneSpec } from "./laneRegistry";

export { NotSentError };

/** A Convex action runs at most ten minutes, so a live action's claim never expires under it. */
export const CONVEX_LEASE_MS = 11 * 60_000;

/** A conversation command waits in its route's platform lane; model work waits in the ai lane, a precompute or a person summary in aiBackground. */
export function laneOf(platform: CommaPlatform, payload: CommaOutboxPayload): LaneSpec {
  if ((payload.kind === "suggestions" && payload.precompute) || payload.kind === "personSummary") return AI_BACKGROUND_LANE;
  return isAiKind(payload.kind) ? AI_LANE : PLATFORM_LANES[platform];
}

export function laneSpec(lane: CommaOutboxLane): LaneSpec {
  const spec = [AI_LANE, AI_BACKGROUND_LANE, ...Object.values(PLATFORM_LANES)].find((candidate) => candidate.lane === lane);
  if (!spec) throw new Error(`No executor for the ${lane} lane`);
  return spec;
}

/** The row's own lane; a row queued before lanes was iMessage's or model work. */
export function laneOfRow(row: Doc<"comma_outbox">): LaneSpec {
  return row.lane ? laneSpec(row.lane) : laneOf(row.route?.platform ?? "imessage", row.payload);
}

const driveRef = makeFunctionReference<"action", { lane: CommaOutboxLane }, null>("comma/lanes:drive");
const claimRef = makeFunctionReference<"mutation", { now: number; leaseMs: number; limit: number; lane: CommaOutboxLane }, Doc<"comma_outbox">[]>("comma/outbox:claimOutbox");
type Completion = { status: "sent"; result: CommandResult; resultGuid?: string } | { status: "failed" | "unknown"; error: string };
const completeRef = makeFunctionReference<"mutation", { clientKey: string; claimToken: string } & Completion, boolean>("comma/outbox:completeOutbox");

/** Starts a convex lane's executor at `at`. A pull lane's executor learns of work by its own subscription. */
export async function wakeLane(ctx: Pick<MutationCtx, "scheduler">, lane: CommaOutboxLane, at = Date.now()): Promise<void> {
  if (laneSpec(lane).executor === "convex") await ctx.scheduler.runAt(at, driveRef, { lane });
}

/**
 * A convex lane's executor: claims one row at a time and runs it, until the lane is empty. A drive that finds the
 * lane busy exits, so one row at a time runs. A drive that dies leaves its claim to expire, and the wake that
 * claimOutbox scheduled for that moment recovers it by the shared retry policy.
 */
export const drive = internalAction({
  args: { lane: outboxLane },
  returns: v.null(),
  handler: async (ctx, { lane }) => {
    const spec = laneSpec(lane);
    if (spec.executor !== "convex") return null;
    for (;;) {
      const [row] = await ctx.runMutation(claimRef, { now: Date.now(), leaseMs: CONVEX_LEASE_MS, limit: 1, lane });
      if (!row?.claimToken) return null;
      let completion: Completion;
      try {
        const result = await spec.execute(ctx, row);
        const resultGuid = "message" in result ? result.message.guid : "guid" in result ? result.guid : undefined;
        completion = { status: "sent", result, ...(resultGuid ? { resultGuid } : {}) };
      } catch (error) {
        completion = { status: error instanceof NotSentError ? "failed" : "unknown", error: error instanceof Error ? error.message : String(error) };
      }
      await ctx.runMutation(completeRef, { clientKey: row.clientKey, claimToken: row.claimToken, ...completion });
    }
  },
});
