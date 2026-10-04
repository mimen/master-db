import { makeFunctionReference } from "convex/server";
import type { Infer } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";

import { api, internal } from "../_generated/api";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import type { ephemeralInput } from "./presence";

const publish = makeFunctionReference<"mutation", { state: Infer<typeof ephemeralInput> }, boolean>("comma/presence:publish");
const presence = makeFunctionReference<"query", { conversationId: import("convex/values").GenericId<"comma_conversations"> }, { peerTyping: boolean; updatedAt: number; expiresAt: number } | null>("comma/presence:presence");
const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const aliases = await t.mutation(internal.comma.internal.upsertConversations, { conversations: [{
    conversationKey: "dm:+15550001111", displayName: "Alex", isGroup: false, participants: [], lastMessageAt: 0,
    isSpam: false, hasGroupPhoto: false, chats: [{ chatGuid: "iMessage;-;+15550001111", lastMessageAt: 2 }, { chatGuid: "SMS;-;+15550001111", lastMessageAt: 1 }],
  }] });
  const conversationId = aliases["iMessage;-;+15550001111"];
  return { t, as: t.withIdentity({ subject: `${userId}|session` }), conversationId, aliases };
}

test("incoming typing on, off, expiry and old retries use one canonical row", async () => {
  const { t, as, conversationId, aliases } = await setup();
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  expect(aliases["SMS;-;+15550001111"]).toBe(conversationId);
  expect(await as.query(presence, { conversationId })).toBeNull();
  const on = { kind: "presence" as const, conversationId, peerTyping: true, updatedAt: 1000, expiresAt: 13_000 };
  await t.mutation(publish, { state: on });
  expect(await as.query(presence, { conversationId })).toMatchObject({ peerTyping: true });
  clock.mockReturnValue(13_000);
  expect(await as.query(presence, { conversationId })).toEqual({ peerTyping: true, updatedAt: 1000, expiresAt: 13_000 });
  await t.mutation(publish, { state: { ...on, peerTyping: false, updatedAt: 14_000, expiresAt: 14_000 } });
  expect(await t.mutation(publish, { state: on })).toBe(false);
  expect(await as.query(presence, { conversationId })).toEqual({ peerTyping: false, updatedAt: 14_000, expiresAt: 14_000 });
  expect(await t.run((ctx) => ctx.db.query("comma_presence").collect())).toHaveLength(1);
  await t.mutation(publish, { state: { ...on, updatedAt: 15_000 } });
  expect(await t.run((ctx) => ctx.db.query("comma_presence").unique())).toMatchObject({ peerTyping: false });
});

test("typing freshness coalesces per conversation, fences claims and discards expired on commands", async () => {
  vi.useFakeTimers();
  const { t, as, conversationId } = await setup();
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  await as.mutation(api.comma.outbox.enqueue, { conversationId, clientKey: "on", payload: { kind: "typing", active: true, expiresAt: 2000 } });
  const [on] = await t.mutation(internal.comma.outbox.claimOutbox, { now: 1000, leaseMs: 60_000, limit: 1 });
  const check = () => t.mutation(publish, { state: { kind: "typingCurrent", clientKey: on.clientKey, claimToken: on.claimToken! } });
  expect(await check()).toBe(true);
  expect(await t.mutation(publish, { state: { kind: "typingCurrent", clientKey: on.clientKey, claimToken: "old claim" } })).toBe(false);
  clock.mockReturnValue(2000);
  expect(await check()).toBe(false);
  clock.mockReturnValue(1000);
  await as.mutation(api.comma.outbox.enqueue, { conversationId, clientKey: "off", payload: { kind: "typing", active: false, expiresAt: 1000 } });
  expect(await check()).toBe(false);
  const [off] = await t.mutation(internal.comma.outbox.claimOutbox, { now: 1000, leaseMs: 60_000, limit: 1 });
  clock.mockReturnValue(3000);
  expect(await t.mutation(publish, { state: { kind: "typingCurrent", clientKey: off.clientKey, claimToken: off.claimToken! } })).toBe(true);
});

test("presence reads are authenticated and ephemeral ingest authenticates and validates", async () => {
  const { t, conversationId } = await setup();
  await expect(t.query(presence, { conversationId })).rejects.toThrow("Unauthorized");
  vi.stubEnv("COMMA_BRIDGE_SECRET", "presence-test");
  try {
    const init = { method: "POST", headers: { authorization: "Bearer presence-test", "content-type": "application/json" },
      body: JSON.stringify({ state: { kind: "presence", conversationId, peerTyping: false, updatedAt: Date.now(), expiresAt: Date.now() } }) };
    expect((await t.fetch("/comma/ingest/ephemeral", init)).status).toBe(200);
    expect((await t.fetch("/comma/ingest/ephemeral", { ...init, headers: {} })).status).toBe(401);
    expect((await t.fetch("/comma/ingest/ephemeral", { ...init, body: JSON.stringify({ state: { kind: "presence" } }) })).status).toBe(400);
  } finally { vi.unstubAllEnvs(); }
});

test("durable expiry queues a clear after the bridge dies and never clears a newer transition", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const { t, as, conversationId } = await setup();
  const onArgs = { conversationId, clientKey: "on-before-crash", payload: { kind: "typing" as const, active: true, expiresAt: 2000 } };
  const commandId = await as.mutation(api.comma.outbox.enqueue, onArgs);
  const [on] = await t.mutation(internal.comma.outbox.claimOutbox, { now: 1000, leaseMs: 60_000, limit: 1 });
  const check = { state: { kind: "typingCurrent" as const, clientKey: on.clientKey, claimToken: on.claimToken! } };
  await t.mutation(publish, check);
  await t.mutation(publish, check);
  await t.mutation(internal.comma.outbox.completeOutbox, { clientKey: on.clientKey, claimToken: on.claimToken!, status: "sent", result: { kind: "typing", ok: true } });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const pending = await t.run((ctx) => ctx.db.query("comma_outbox").withIndex("by_status_createdAt", (q) => q.eq("status", "pending")).collect());
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({ clientKey: `typing-expire:${commandId}`, payload: { kind: "typing", active: false, expiresAt: 2000 } });

  vi.setSystemTime(3000);
  await as.mutation(api.comma.outbox.enqueue, { ...onArgs, clientKey: "superseded-on", payload: { kind: "typing", active: true, expiresAt: 4000 } });
  await t.mutation(internal.comma.outbox.claimOutbox, { now: 3000, leaseMs: 60_000, limit: 1 });
  const [old] = await t.mutation(internal.comma.outbox.claimOutbox, { now: 3000, leaseMs: 60_000, limit: 1 });
  await t.mutation(publish, { state: { kind: "typingCurrent", clientKey: old.clientKey, claimToken: old.claimToken! } });
  const newerId = await as.mutation(api.comma.outbox.enqueue, { ...onArgs, clientKey: "newer-on", payload: { kind: "typing", active: true, expiresAt: 10_000 } });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", `typing-expire:${old._id}`)).unique())).toBeNull();
  expect(await t.run((ctx) => ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", `typing-expire:${newerId}`)).unique())).toMatchObject({ payload: { kind: "typing", active: false, expiresAt: 10_000 } });
});
