import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const SECRET = "bridge-secret";
const previous = process.env.COMMA_BRIDGE_SECRET;
beforeEach(() => {
  process.env.COMMA_BRIDGE_SECRET = SECRET;
});
afterEach(() => {
  if (previous === undefined) delete process.env.COMMA_BRIDGE_SECRET;
  else process.env.COMMA_BRIDGE_SECRET = previous;
});

type T = TestConvex<typeof schema>;

async function setup(): Promise<{ t: T; as: ReturnType<T["withIdentity"]>; c: Id<"comma_conversations"> }> {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const c = await t.run((ctx) =>
    ctx.db.insert("comma_conversations", {
      conversationKey: "dm:+15550001111",
      primaryChatGuid: "iMessage;-;+15550001111",
      chatGuids: ["iMessage;-;+15550001111"],
      displayName: "Alex",
      isGroup: false,
      participants: [],
      lastMessageAt: 1,
      isSpam: false,
      hasGroupPhoto: false,
      updatedAt: 1,
    }),
  );
  return { t, as: t.withIdentity({ subject: `${userId}|session` }), c };
}

const send = { kind: "send" as const, text: "hello" };

describe("enqueue", () => {
  test("is idempotent on clientKey and inserts one temp bubble", async () => {
    const { t, as, c } = await setup();
    const a = await as.mutation(api.comma.outbox.enqueue, { clientKey: "k1", conversationId: c, payload: send });
    const b = await as.mutation(api.comma.outbox.enqueue, { clientKey: "k1", conversationId: c, payload: send });
    const temps = await t.run((ctx) => ctx.db.query("comma_messages").collect());
    expect(a).toBe(b);
    expect(temps.map((m) => [m.guid, m.text, m.clientKey])).toEqual([["temp-k1", "hello", "k1"]]);
  });

  test("requires Convex Auth", async () => {
    const { t, c } = await setup();
    await expect(t.mutation(api.comma.outbox.enqueue, { clientKey: "k", conversationId: c, payload: send })).rejects.toThrow();
  });
});

describe("the echo", () => {
  test("replaces the temp row that carries the same clientKey", async () => {
    const { t, as, c } = await setup();
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "k1", conversationId: c, payload: send });
    await t.mutation(internal.comma.internal.upsertMessages, {
      messages: [
        {
          guid: "real-1",
          conversationId: c,
          chatGuid: "iMessage;-;+15550001111",
          dateCreated: 5,
          isFromMe: true,
          text: "hello",
          service: "iMessage",
          error: 0,
          edited: false,
          retracted: false,
          isTapback: false,
          reactions: [],
          isGroupEvent: false,
          mentions: [],
          attachmentGuids: [],
          clientKey: "k1",
          sourceVersion: 1000,
        },
      ],
    });
    const guids = await t.run(async (ctx) => (await ctx.db.query("comma_messages").collect()).map((m) => m.guid));
    expect(guids).toEqual(["real-1"]);
  });
});

describe("claim and complete", () => {
  test("an expired lease makes a send unknown but returns an idempotent kind to pending", async () => {
    const { t, as, c } = await setup();
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "s", conversationId: c, payload: send });
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "p", conversationId: c, payload: { kind: "pin", value: true } });
    const claimed = await t.mutation(internal.comma.outbox.claimOutbox, { now: 1000, leaseMs: 100, limit: 10 });
    expect(claimed.map((r) => r.clientKey).sort()).toEqual(["p", "s"]);
    await t.mutation(internal.comma.outbox.claimOutbox, { now: 5000, leaseMs: 100, limit: 0 });
    const rows = await t.run((ctx) => ctx.db.query("comma_outbox").collect());
    const status = Object.fromEntries(rows.map((r) => [r.clientKey, r.status]));
    expect(status).toEqual({ s: "unknown", p: "pending" });
  });

  test("complete records the outcome", async () => {
    const { t, as, c } = await setup();
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "s", conversationId: c, payload: send });
    await t.mutation(internal.comma.outbox.claimOutbox, { now: 1, leaseMs: 1000, limit: 10 });
    await t.mutation(internal.comma.outbox.completeOutbox, { clientKey: "s", status: "failed", error: "BB 500" });
    const states = await as.query(api.comma.outbox.outboxStatusFor, { clientKeys: ["s"] });
    expect(states).toEqual([{ clientKey: "s", status: "failed", error: "BB 500" }]);
  });
});

describe("pendingOutbox", () => {
  test("only answers the bridge secret", async () => {
    const { t, as, c } = await setup();
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "s", conversationId: c, payload: send });
    await expect(t.query(api.comma.outbox.pendingOutbox, { bridgeKey: "wrong" })).rejects.toThrow();
    const rows = await t.query(api.comma.outbox.pendingOutbox, { bridgeKey: SECRET });
    expect(rows.map((r) => r.clientKey)).toEqual(["s"]);
  });
});
