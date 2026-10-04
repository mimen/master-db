import { makeFunctionReference } from "convex/server";
import type { Infer } from "convex/values";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import type { BridgeState } from "./bridgeState";
import type { ephemeralInput } from "./presence";

const publish = makeFunctionReference<"mutation", { state: Infer<typeof ephemeralInput> }, boolean>("comma/presence:publish");
const bridgeState = makeFunctionReference<"query", Record<string, never>, BridgeState | null>("comma/bridgeState:bridgeState");
const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

test("bridge state is a singleton, preserves heartbeat freshness and removes obsolete details", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const as = t.withIdentity({ subject: `${userId}|session` });
  expect(await as.query(bridgeState, {})).toBeNull();
  const state = { kind: "bridgeState" as const, key: "mini" as const, privateApi: false, suggestions: false,
    reactionSuggestions: false, whisperAvailable: false, whisperDetail: "missing binary", lastSeenAt: 1000 };
  await t.mutation(publish, { state });
  expect(await as.query(bridgeState, {})).toMatchObject({ lastSeenAt: 1000, whisperDetail: "missing binary" });
  const { whisperDetail: _detail, ...available } = state;
  await t.mutation(publish, { state: { ...available, privateApi: true, whisperAvailable: true, lastSeenAt: 61_000 } });
  await t.mutation(publish, { state });
  expect(await as.query(bridgeState, {})).toEqual({ key: "mini", privateApi: true, suggestions: false,
    reactionSuggestions: false, whisperAvailable: true, lastSeenAt: 61_000 });
  expect(await t.run((ctx) => ctx.db.query("comma_bridge_state").collect())).toHaveLength(1);
  await expect(t.query(bridgeState, {})).rejects.toThrow("Unauthorized");
});
