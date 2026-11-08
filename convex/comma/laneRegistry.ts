import type { Doc } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import type { CommandResult, CommaOutboxLane, CommaPlatform } from "../schema/comma/validators";

import { applyGmailFailure, applyGmailResult, checkUnknownGmailSend, executeGmail } from "./gmailLane";
import { applyIMessageResult } from "./imessageResults";
import { applySlackResult, checkUnknownSend, executeSlack } from "./slackLane";

type OutboxRow = Doc<"comma_outbox">;

/**
 * What a convex lane's execute throws when the platform never took the command: it refused it, or the request never
 * left. Only this fails a row, which the user may retry. Any other throw may come after the platform acted (a timeout
 * on a send that landed), so the row ends unknown and is never replayed.
 */
export class NotSentError extends Error {}

/**
 * Who runs a lane's commands. A pull lane waits for an outside executor to claim its rows (the Mini, for iMessage);
 * a convex lane runs each row in a Convex action, scheduled at enqueue. Both share the claim token, lease and receipt.
 */
export type LaneSpec = {
  lane: CommaOutboxLane;
  /** What a confirmed command changes in Convex that no platform event will report. */
  onResult?: (ctx: MutationCtx, row: OutboxRow) => Promise<void>;
  /** What a failed command takes back in Convex. */
  onFailed?: (ctx: MutationCtx, row: OutboxRow) => Promise<void>;
  /** Looks for a command whose outcome is unknown, without running it again. */
  onUnknown?: (ctx: MutationCtx, row: OutboxRow) => Promise<void>;
} & ({ executor: "pull" } | { executor: "convex"; execute: (ctx: ActionCtx, row: OutboxRow) => Promise<CommandResult> });

export const PLATFORM_LANES: Record<CommaPlatform, LaneSpec> = {
  imessage: { lane: "imessage", executor: "pull", onResult: applyIMessageResult },
  slack: { lane: "slack", executor: "convex", execute: executeSlack, onResult: applySlackResult, onUnknown: checkUnknownSend },
  gmail: { lane: "gmail", executor: "convex", execute: executeGmail, onResult: applyGmailResult, onFailed: applyGmailFailure, onUnknown: checkUnknownGmailSend },
};

/** Model work, whatever the conversation's platform. The Mini's AI process claims it. */
export const AI_LANE: LaneSpec = { lane: "ai", executor: "pull" };
/** Model work nobody is waiting on; the AI process drains it beside the ai lane. */
export const AI_BACKGROUND_LANE: LaneSpec = { lane: "aiBackground", executor: "pull" };
