import { v, type Infer } from "convex/values";

import { accountStatusKey, AI_STATUS_KEY, routeStatus } from "../../apps/imsg/shared/executors";
import type { Doc } from "../_generated/dataModel";
import { query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { executorStatusFields, legacyBridgeStateFields, platform, type CommaRoute } from "../schema/comma/validators";

import { ensureAccount } from "./accounts";
import { IMESSAGE_ACCOUNT } from "./conversationIdentity";

export const executorStatusValue = v.object(executorStatusFields);
export type ExecutorStatus = Infer<typeof executorStatusValue>;
export const legacyBridgeStateValue = v.object(legacyBridgeStateFields);
type LegacyBridgeState = Infer<typeof legacyBridgeStateValue>;
type Capabilities<E extends ExecutorStatus["capabilities"]["executor"]> = Extract<ExecutorStatus["capabilities"], { executor: E }>;

const isStatus = (row: Doc<"comma_bridge_state">): row is Doc<"comma_bridge_state"> & ExecutorStatus => "capabilities" in row;
const strip = ({ _id: _id, _creationTime: _creationTime, ...status }: Doc<"comma_bridge_state"> & ExecutorStatus): ExecutorStatus => status;

/** One row per executor; an older heartbeat arriving late never replaces a newer one. */
export async function publishExecutorStatus(ctx: MutationCtx, status: ExecutorStatus): Promise<void> {
  const existing = await ctx.db.query("comma_bridge_state").withIndex("by_key", (q) => q.eq("key", status.key)).unique();
  if (existing && isStatus(existing) && existing.lastSeenAt > status.lastSeenAt) return;
  if (existing) await ctx.db.replace(existing._id, status);
  else await ctx.db.insert("comma_bridge_state", status);
}

/** A Mini from before per-executor status publishes one row for its bridge and its AI; each lands in its own. */
export async function publishLegacyBridgeState(ctx: MutationCtx, legacy: LegacyBridgeState): Promise<void> {
  const account = await ensureAccount(ctx, IMESSAGE_ACCOUNT);
  const { lastSeenAt } = legacy;
  await publishExecutorStatus(ctx, { key: accountStatusKey("imessage", account._id), connected: true, lastSeenAt,
    capabilities: { executor: "imessage", privateApi: legacy.privateApi, emojiReactions: legacy.emojiReactions ?? false } });
  await publishExecutorStatus(ctx, { key: AI_STATUS_KEY, connected: true, lastSeenAt, capabilities: {
    executor: "ai", suggestions: legacy.suggestions, whisperAvailable: legacy.whisperAvailable,
    ...(legacy.whisperDetail !== undefined ? { whisperDetail: legacy.whisperDetail } : {}) } });
  const mini = await ctx.db.query("comma_bridge_state").withIndex("by_key", (q) => q.eq("key", "mini")).unique();
  if (mini) await ctx.db.delete(mini._id);
}

export async function executorStatuses(ctx: QueryCtx): Promise<ExecutorStatus[]> {
  return (await ctx.db.query("comma_bridge_state").collect()).filter(isStatus).map(strip);
}

/** The AI process's status, with its capabilities, or null before it first reports. */
export async function aiExecutorStatus(ctx: QueryCtx): Promise<(ExecutorStatus & { capabilities: Capabilities<"ai"> }) | null> {
  const row = await ctx.db.query("comma_bridge_state").withIndex("by_key", (q) => q.eq("key", AI_STATUS_KEY)).unique();
  return row && isStatus(row) && row.capabilities.executor === "ai" ? { ...strip(row), capabilities: row.capabilities } : null;
}

/** What the route's executor reports its platform can send; absent before it first reports. */
export async function imessageCapabilities(ctx: QueryCtx, route: Pick<CommaRoute, "platform" | "accountId">): Promise<Capabilities<"imessage"> | null> {
  const status = routeStatus(await executorStatuses(ctx), route);
  return status?.capabilities.executor === "imessage" ? status.capabilities : null;
}

/**
 * The status of the executor that runs a route's commands, or null before it reports. One row per subscriber, so an
 * executor's heartbeat re-renders only the conversations it runs.
 */
export const routeExecutorStatus = query({
  args: { platform, accountId: v.union(v.id("comma_accounts"), v.null()) },
  returns: v.union(executorStatusValue, v.null()),
  handler: async (ctx, route) => {
    await assertAllowed(ctx);
    return routeStatus(await executorStatuses(ctx), route);
  },
});

/** The single-row shape clients from before per-executor status read, assembled from the iMessage and AI rows. */
export const bridgeState = query({
  args: {},
  returns: v.union(legacyBridgeStateValue, v.null()),
  handler: async (ctx) => {
    await assertAllowed(ctx);
    const rows = await executorStatuses(ctx);
    const mini = routeStatus(rows, { platform: "imessage" });
    const ai = await aiExecutorStatus(ctx);
    if (mini?.capabilities.executor !== "imessage") return null;
    const { privateApi, emojiReactions } = mini.capabilities;
    return { key: "mini" as const, privateApi, emojiReactions, lastSeenAt: mini.lastSeenAt,
      suggestions: ai?.capabilities.suggestions ?? false, reactionSuggestions: privateApi,
      whisperAvailable: ai?.capabilities.whisperAvailable ?? false,
      ...(ai?.capabilities.whisperDetail !== undefined ? { whisperDetail: ai.capabilities.whisperDetail } : {}) };
  },
});
