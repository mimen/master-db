import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import type { CommandResult } from "../schema/comma/validators";
import { normalizeModules } from "../test-utils.vitest";

import { CONVEX_LEASE_MS, laneOf } from "./lanes";

// The fake platform lane: iMessage's route, executed in a Convex action instead of claimed by the Mini.
const fake = vi.hoisted(() => ({
  execute: vi.fn<(ctx: unknown, row: Doc<"comma_outbox">) => Promise<CommandResult>>(),
  onResult: vi.fn<(ctx: unknown, row: Doc<"comma_outbox">) => Promise<void>>(),
}));
vi.mock("./laneRegistry", async (importOriginal) => ({
  ...await importOriginal<typeof import("./laneRegistry")>(),
  PLATFORM_LANES: { imessage: { lane: "imessage", executor: "convex", execute: fake.execute, onResult: fake.onResult } },
}));

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

beforeEach(() => {
  vi.useFakeTimers();
  fake.execute.mockReset();
  fake.onResult.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const c = await t.run((ctx) => ctx.db.insert("comma_conversations", {
    conversationKey: "dm:+15550001111", primaryChatGuid: "iMessage;-;+15550001111", chatGuids: ["iMessage;-;+15550001111"],
    displayName: "Alex", isGroup: false, participants: [], lastMessageAt: 1, isSpam: false, hasGroupPhoto: false, updatedAt: 1,
  }));
  const as = t.withIdentity({ subject: `${userId}|session` });
  const rows = () => t.run((ctx) => ctx.db.query("comma_outbox").collect());
  return { t, as, c, rows };
}

const sent = (row: Doc<"comma_outbox">): CommandResult =>
  row.payload.kind === "markRead" ? { kind: "markRead", ok: true } : { kind: "react", ok: true };

describe("a convex-executed lane", () => {
  test("enqueue starts an action that claims, runs and completes each row through the shared receipt", async () => {
    const { t, as, c, rows } = await setup();
    fake.execute.mockImplementation(async (_ctx, row) => sent(row));
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "r1", conversationId: c, payload: { kind: "react", messageGuid: "m1", reaction: "love", remove: false } });
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "r2", conversationId: c, payload: { kind: "markRead" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fake.execute.mock.calls.map(([, row]) => [row.clientKey, row.status, row.claimToken, row.lane]))
      .toEqual([["r1", "claimed", `${(await rows())[0]._id}:1`, "imessage"], ["r2", "claimed", `${(await rows())[1]._id}:1`, "imessage"]]);
    expect((await rows()).map((row) => [row.clientKey, row.status, row.result?.kind, row.leaseUntil])).toEqual([
      ["r1", "sent", "react", undefined], ["r2", "sent", "markRead", undefined],
    ]);
    expect(fake.onResult.mock.calls.map(([, row]) => row.clientKey)).toEqual(["r1", "r2"]);
  });

  test("a failed execution fails only its row and the lane drains on", async () => {
    const { t, as, c, rows } = await setup();
    fake.execute.mockImplementation(async (_ctx, row) => {
      if (row.clientKey === "bad") throw new Error("platform refused");
      return sent(row);
    });
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "bad", conversationId: c, payload: { kind: "markRead" } });
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "good", conversationId: c, payload: { kind: "markRead" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await rows()).map((row) => [row.clientKey, row.status, row.error])).toEqual([
      ["bad", "failed", "platform refused"], ["good", "sent", undefined],
    ]);
    expect(fake.onResult.mock.calls.map(([, row]) => row.clientKey)).toEqual(["good"]);
  });

  test("a claim whose action died is recovered at its lease's expiry by the retry policy", async () => {
    const { t, c, rows } = await setup();
    fake.execute.mockImplementation(async (_ctx, row) => sent(row));
    const now = Date.now();
    // Rows inserted without enqueue's wake, then claimed as an action would before dying.
    await t.run(async (ctx) => {
      for (const [clientKey, payload] of [["react", { kind: "react", messageGuid: "m1", reaction: "love", remove: false }], ["read", { kind: "markRead" }]] as const) {
        await ctx.db.insert("comma_outbox", { clientKey, conversationId: c, payload, lane: "imessage", status: "pending", attempts: 0, createdAt: now, updatedAt: now });
      }
    });
    const claimed = await t.mutation(internal.comma.outbox.claimOutbox, { now, leaseMs: CONVEX_LEASE_MS, limit: 1, lane: "imessage" });
    expect(claimed.map((row) => row.clientKey)).toEqual(["react"]);
    // The lane is busy until that claim expires: nothing else is claimed under it.
    expect(await t.mutation(internal.comma.outbox.claimOutbox, { now, leaseMs: CONVEX_LEASE_MS, limit: 1, lane: "imessage" })).toEqual([]);

    vi.advanceTimersByTime(CONVEX_LEASE_MS + 2);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // A reaction may have gone out, so it is never replayed; the read behind it runs.
    expect((await rows()).map((row) => [row.clientKey, row.status, row.error])).toEqual([
      ["react", "unknown", "bridge stopped before confirming the command"], ["read", "sent", undefined],
    ]);
    expect(fake.execute.mock.calls.map(([, row]) => row.clientKey)).toEqual(["read"]);
  });

  test("model work keeps its own pull lanes whatever the platform's executor", () => {
    expect(laneOf("imessage", { kind: "suggestions", model: "opus", refresh: false })).toMatchObject({ lane: "ai", executor: "pull" });
    expect(laneOf("imessage", { kind: "suggestions", model: "opus", refresh: false, precompute: true })).toMatchObject({ lane: "aiBackground", executor: "pull" });
    expect(laneOf("imessage", { kind: "send", text: "hi" })).toMatchObject({ lane: "imessage", executor: "convex" });
  });
});
