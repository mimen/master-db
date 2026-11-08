import { makeFunctionReference } from "convex/server";
import type { Infer } from "convex/values";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import type { ExecutorStatus, legacyBridgeStateValue } from "./bridgeState";
import type { ephemeralInput } from "./presence";

const publish = makeFunctionReference<"mutation", { state: Infer<typeof ephemeralInput> }, boolean>("comma/presence:publish");
const routeStatus = makeFunctionReference<"query", { platform: "imessage"; accountId: Id<"comma_accounts"> | null }, ExecutorStatus | null>("comma/bridgeState:routeExecutorStatus");
const bridgeState = makeFunctionReference<"query", Record<string, never>, Infer<typeof legacyBridgeStateValue> | null>("comma/bridgeState:bridgeState");
const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const statuses = () => t.run(async (ctx) => (await ctx.db.query("comma_bridge_state").collect())
    .map(({ _id: _id, _creationTime: _creationTime, ...row }) => row));
  return { t, as: t.withIdentity({ subject: `${userId}|session` }), statuses };
}

test("each executor keeps one status row, and a late heartbeat never replaces a newer one", async () => {
  const { t, statuses } = await setup();
  expect(await statuses()).toEqual([]);
  const ai = { kind: "executorStatus" as const, key: "ai", connected: false, detail: "no gateway key", lastSeenAt: 1000,
    capabilities: { executor: "ai" as const, suggestions: false, whisperAvailable: false, whisperDetail: "missing binary" } };
  await t.mutation(publish, { state: ai });
  const { detail: _detail, ...connected } = ai;
  await t.mutation(publish, { state: { ...connected, connected: true, lastSeenAt: 61_000, capabilities: { executor: "ai", suggestions: true, whisperAvailable: true } } });
  await t.mutation(publish, { state: ai });
  await t.mutation(publish, { state: { kind: "executorStatus", key: "imessage:acct", connected: true, lastSeenAt: 5,
    capabilities: { executor: "imessage", privateApi: true, emojiReactions: false } } });
  expect(await statuses()).toEqual([
    { key: "ai", connected: true, lastSeenAt: 61_000, capabilities: { executor: "ai", suggestions: true, whisperAvailable: true } },
    { key: "imessage:acct", connected: true, lastSeenAt: 5, capabilities: { executor: "imessage", privateApi: true, emojiReactions: false } },
  ]);
});

test("a route reads its own account's executor, and a route from before accounts reads the platform's only one", async () => {
  const { t, as } = await setup();
  const account = await t.run((ctx) => ctx.db.insert("comma_accounts", { platform: "imessage", externalId: "mini", label: "iMessage", selfHandles: [], health: "ok", createdAt: 1 }));
  expect(await as.query(routeStatus, { platform: "imessage", accountId: account })).toBeNull();
  const status = { key: `imessage:${account}`, connected: true, lastSeenAt: 5, capabilities: { executor: "imessage" as const, privateApi: true, emojiReactions: false } };
  await t.mutation(publish, { state: { kind: "executorStatus", ...status } });
  await t.mutation(publish, { state: { kind: "executorStatus", key: "ai", connected: true, lastSeenAt: 6, capabilities: { executor: "ai", suggestions: true, whisperAvailable: false } } });
  expect(await as.query(routeStatus, { platform: "imessage", accountId: account })).toEqual(status);
  expect(await as.query(routeStatus, { platform: "imessage", accountId: null })).toEqual(status);
  await expect(t.query(routeStatus, { platform: "imessage", accountId: null })).rejects.toThrow("Unauthorized");
});

test("a Mini from before per-executor status lands in its iMessage account's row and the AI row", async () => {
  const { t, as, statuses } = await setup();
  await t.run((ctx) => ctx.db.insert("comma_bridge_state", { key: "mini", privateApi: false, suggestions: false,
    reactionSuggestions: false, whisperAvailable: false, lastSeenAt: 1 }));
  const legacy = { key: "mini" as const, privateApi: true, emojiReactions: true, suggestions: true, reactionSuggestions: true,
    whisperAvailable: false, whisperDetail: "missing binary", lastSeenAt: 2000 };
  await t.mutation(publish, { state: { kind: "bridgeState", ...legacy } });
  const account = await t.run(async (ctx) => (await ctx.db.query("comma_accounts").unique())!._id);
  expect(await statuses()).toEqual([
    { key: `imessage:${account}`, connected: true, lastSeenAt: 2000, capabilities: { executor: "imessage", privateApi: true, emojiReactions: true } },
    { key: "ai", connected: true, lastSeenAt: 2000, capabilities: { executor: "ai", suggestions: true, whisperAvailable: false, whisperDetail: "missing binary" } },
  ]);
  expect(await t.run((ctx) => ctx.db.query("comma_bridge_state").withIndex("by_key", (q) => q.eq("key", "mini")).collect())).toEqual([]);
  // A client from before per-executor status still reads its one row.
  expect(await as.query(bridgeState, {})).toEqual(legacy);
});
