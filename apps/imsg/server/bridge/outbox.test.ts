import { expect, test } from "bun:test";
import type { ConvexClient } from "convex/browser";
import { ChatCommands } from "../commands";
import { ChatDirectory } from "../chat-directory";
import { ContactBook } from "../contacts";
import { FakeBlueBubbles } from "../bluebubbles-fake";
import type { LeaseTimers } from "./commands/lease";
import { OverlayDb } from "../db";
import { FakeIngest } from "./fake-ingest";
import { MessageWriter } from "./live";
import { OutboxBridge, type OutboxRow } from "./outbox";

const CHAT = "iMessage;-;+15550001111";

/** A ConvexClient stand-in whose subscription fires on demand. */
function fakeClient() {
  let push: ((rows: OutboxRow[]) => void) | null = null;
  const client = {
    onUpdate: (_ref: unknown, _args: unknown, callback: (rows: OutboxRow[]) => void) => {
      push = callback;
      return () => { push = null; };
    },
    close: () => Promise.resolve(),
  } as unknown as ConvexClient;
  return { client, fire: (rows: OutboxRow[]) => push?.(rows) };
}

function harness(now = 1_000) {
  const bb = new FakeBlueBubbles({ chats: [{ guid: CHAT, participants: [{ address: "+15550001111" }],
    messages: [{ guid: "m1", originalROWID: 1, text: "hello", dateCreated: 500 }] }] });
  const db = new OverlayDb(":memory:");
  const ingest = new FakeIngest();
  const contacts = new ContactBook(bb);
  const commands = new ChatCommands(bb, new ChatDirectory(bb, db, contacts), contacts);
  const writer = new MessageWriter({ bb, db, ingest });
  writer.conversationIds.set(CHAT, ingest.id);
  const { client, fire } = fakeClient();
  const start = (options: Pick<ConstructorParameters<typeof OutboxBridge>[0], "handlers" | "leaseTimers"> = {}) => new OutboxBridge({
    config: { convexCloudUrl: "https://convex.test", commaBridgeSecret: "test" },
    writer, commands, client, now: () => now, ...options,
  });
  return { bb, db, ingest, writer, start, fire, setNow: (value: number) => { now = value; } };
}

function row(clientKey: string, payload: OutboxRow["payload"], now = 1_000): OutboxRow {
  return {
    _id: `row-${clientKey}`, _creationTime: now, clientKey, conversationId: "conversation-test",
    payload, claimToken: `claim-${clientKey}`, status: "claimed", attempts: 1, leaseUntil: now + 60_000, createdAt: now, updatedAt: now,
  } as OutboxRow;
}

const completions = (ingest: FakeIngest) =>
  ingest.calls.filter((call) => call.kind === "complete").map((call) => call.body);

test("a send runs once with the clientKey as BlueBubbles' tempGuid and completes as sent", async () => {
  const h = harness();
  await h.writer.refreshChats();
  h.ingest.outboxRows.push(row("k1", { kind: "send", text: "hi there" }));
  const bridge = h.start();
  try {
    await bridge.flush();
    expect(h.bb.sentTexts).toEqual([{ chatGuid: CHAT, message: "hi there" }]);
    const [done] = completions(h.ingest);
    expect(done).toMatchObject({ clientKey: "k1", status: "sent" });
    expect(typeof done?.resultGuid).toBe("string");
    expect(done).toMatchObject({ claimToken: "claim-k1", result: { kind: "send", message: { text: "hi there", chatGuid: CHAT, attachments: [], reactions: [], mentions: [] } } });
  } finally { bridge.stop(); }
});

test("a clean BlueBubbles error completes as failed", async () => {
  const h = harness();
  await h.writer.refreshChats();
  h.bb.sendText = () => Promise.resolve({ ok: false, error: "BB 500" });
  h.ingest.outboxRows.push(row("k1", { kind: "send", text: "hi" }));
  const bridge = h.start();
  try {
    await bridge.flush();
    expect(completions(h.ingest)).toEqual([expect.objectContaining({ clientKey: "k1", status: "failed" })]);
  } finally { bridge.stop(); }
});

test("a transport error mid-send completes as unknown and is never retried", async () => {
  const h = harness();
  await h.writer.refreshChats();
  let attempts = 0;
  h.bb.sendText = () => { attempts++; return Promise.reject(new Error("socket hang up")); };
  h.ingest.outboxRows.push(row("k1", { kind: "send", text: "hi" }));
  const bridge = h.start();
  try {
    await bridge.flush();
    expect(attempts).toBe(1);
    expect(completions(h.ingest)).toEqual([expect.objectContaining({ clientKey: "k1", status: "unknown" })]);
  } finally { bridge.stop(); }
});

test("pin writes the overlay and completes as sent", async () => {
  const h = harness();
  await h.writer.refreshChats();
  h.ingest.outboxRows.push(row("p1", { kind: "pin", value: true }));
  const bridge = h.start();
  try {
    await bridge.flush();
    expect(h.db.getAll().get(CHAT)?.pinned).toBe(1);
    expect(completions(h.ingest)).toEqual([expect.objectContaining({ clientKey: "p1", status: "sent" })]);
  } finally { bridge.stop(); }
});

test("an expired lease is skipped rather than executed", async () => {
  const h = harness(100_000);
  await h.writer.refreshChats();
  h.ingest.outboxRows.push(row("old", { kind: "send", text: "stale" }, 1_000));
  const bridge = h.start();
  try {
    await bridge.flush();
    expect(h.bb.sentTexts).toEqual([]);
    expect(completions(h.ingest)).toEqual([]);
  } finally { bridge.stop(); }
});

test("a disabled bridge does not subscribe or claim", async () => {
  const h = harness();
  const bridge = new OutboxBridge({
    config: { convexCloudUrl: null, commaBridgeSecret: "test" },
    writer: h.writer, commands: new ChatCommands(h.bb, new ChatDirectory(h.bb, h.db, new ContactBook(h.bb)), new ContactBook(h.bb)),
  });
  try {
    await bridge.flush();
    expect(h.ingest.calls).toEqual([]);
  } finally { bridge.stop(); }
});


function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function leaseClock() {
  let callback: (() => void) | null = null;
  let stopped = false;
  const timers: LeaseTimers = {
    setInterval: (tick, ms) => {
      expect(ms).toBe(20_000);
      callback = tick;
      return { unref: () => {} } as ReturnType<typeof setInterval>;
    },
    clearInterval: () => { callback = null; stopped = true; },
  };
  return { timers, tick: () => callback?.(), stopped: () => stopped };
}

test("both global kinds skip conversation resolution, and stubs fail cleanly", async () => {
  const h = harness();
  h.writer.resolveConversation = async () => { throw new Error("must not resolve"); };
  for (const payload of [{ kind: "createChat", addresses: ["one"], text: "hi" }, { kind: "clearSuggestionLearning" }] as const) {
    const command = row(payload.kind, { ...payload, ...(payload.kind === "createChat" ? { addresses: ["one"] } : {}) } as OutboxRow["payload"]);
    delete command.conversationId;
    h.ingest.outboxRows.push(command);
  }
  const bridge = h.start({ handlers: { createChat: { execute: async () => { throw new Error("not implemented"); } } } });
  try {
    await bridge.flush();
    expect(completions(h.ingest)).toEqual([
      { clientKey: "createChat", claimToken: "claim-createChat", status: "failed", error: "not implemented" },
      { clientKey: "clearSuggestionLearning", claimToken: "claim-clearSuggestionLearning", status: "failed", error: "not implemented" },
    ]);
    expect(h.bb.sentTexts).toEqual([]);
  } finally { bridge.stop(); }
});

test("global handler receives a null chat and returns its typed result", async () => {
  const h = harness();
  const command = row("global", { kind: "clearSuggestionLearning" });
  delete command.conversationId;
  h.ingest.outboxRows.push(command);
  const bridge = h.start({ handlers: { clearSuggestionLearning: { execute: async (ctx) => {
    expect(ctx.chatGuid).toBeNull();
    return { kind: "clearSuggestionLearning", ok: true };
  } } } });
  try {
    await bridge.flush();
    expect(completions(h.ingest)[0]).toMatchObject({ status: "sent", result: { kind: "clearSuggestionLearning", ok: true } });
  } finally { bridge.stop(); }
});

test("non-global commands with no conversation fail before dispatch", async () => {
  const h = harness();
  const command = row("bad", { kind: "send", text: "hi" });
  delete command.conversationId;
  h.ingest.outboxRows.push(command);
  const bridge = h.start();
  try {
    await bridge.flush();
    expect(h.bb.sentTexts).toEqual([]);
    expect(completions(h.ingest)[0]).toMatchObject({ status: "failed", error: "Command requires a conversation" });
  } finally { bridge.stop(); }
});

test("receipt retry retains the result and claim token without replaying the side effect", async () => {
  const h = harness();
  await h.writer.refreshChats();
  h.ingest.outboxRows.push(row("receipt", { kind: "send", text: "once" }));
  h.ingest.fail = "complete";
  const bridge = h.start();
  try {
    await bridge.flush();
    const first = completions(h.ingest)[0];
    expect(bridge.inFlight).toBe(1);
    h.ingest.fail = null;
    await bridge.flush();
    expect(h.bb.sentTexts).toHaveLength(1);
    expect(completions(h.ingest)).toEqual([first, first]);
    expect(bridge.inFlight).toBe(0);
  } finally { bridge.stop(); }
});

test("long-running handlers renew with their claim token and claim the next job only after completion", async () => {
  const h = harness();
  const clock = leaseClock();
  const entered = deferred(); const release = deferred();
  h.ingest.outboxRows.push(row("long", { kind: "identify" }), row("next", { kind: "clearSuggestionLearning" }));
  const bridge = h.start({ leaseTimers: clock.timers, handlers: { identify: { longRunning: true, execute: async () => {
    entered.resolve(); await release.promise;
    return { kind: "identify", contact: { name: "Alex", confidence: "high", reasoning: "test" } };
  } } } });
  try {
    const flush = bridge.flush(); await entered.promise;
    expect(h.ingest.outboxRows).toHaveLength(1);
    h.setNow(21_000); clock.tick(); await Bun.sleep(0);
    expect(h.ingest.calls.find((call) => call.kind === "renew")?.body).toEqual({ clientKey: "long", claimToken: "claim-long", now: 21_000, leaseMs: 60_000 });
    release.resolve(); await flush;
    expect(completions(h.ingest)[0]).toMatchObject({ status: "sent", result: { kind: "identify" } });
    expect(clock.stopped()).toBe(true);
    expect(h.ingest.calls.filter((call) => call.kind === "claim").every((call) => call.body.limit === 1)).toBe(true);
  } finally { release.resolve(); bridge.stop(); }
});

test("a handler can opt into renewal dynamically; renewal failure aborts and records unknown", async () => {
  const h = harness();
  const clock = leaseClock();
  const entered = deferred(); const release = deferred();
  h.ingest.fail = "renew";
  h.ingest.outboxRows.push(row("lease-lost", { kind: "identify" }));
  const bridge = h.start({ leaseTimers: clock.timers, handlers: { identify: { execute: async (ctx) => ctx.withLeaseRenewal(async () => {
    entered.resolve(); await release.promise;
    expect(ctx.signal.aborted).toBe(true);
    return { kind: "identify", contact: { name: null, confidence: "low", reasoning: "test" } };
  }) } } });
  try {
    const flush = bridge.flush(); await entered.promise;
    clock.tick(); await Bun.sleep(0);
    release.resolve(); await flush;
    expect(completions(h.ingest)[0]).toMatchObject({ status: "unknown", error: expect.stringContaining("lease renewal failed") });
  } finally { release.resolve(); bridge.stop(); }
});

test("schedule and editScheduled return the persisted scheduler rows", async () => {
  const h = harness();
  await h.writer.refreshChats();
  const sendAt = Date.now() + 60_000;
  h.ingest.outboxRows.push(row("schedule", { kind: "schedule", text: " later ", sendAt }));
  const bridge = h.start();
  try {
    await bridge.flush();
    expect(completions(h.ingest)[0]).toMatchObject({ result: { kind: "schedule", scheduled: { id: 1, chatGuid: CHAT, text: "later", sendAt, status: "pending", error: null, sentAt: null } } });
    h.ingest.outboxRows.push(row("edit", { kind: "editScheduled", bbId: 1, text: "updated", sendAt: sendAt + 1000 }));
    h.fire(h.ingest.outboxRows); await bridge.flush();
    expect(completions(h.ingest)[1]).toMatchObject({ result: { kind: "editScheduled", scheduled: { id: 1, text: "updated", sendAt: sendAt + 1000 } } });
  } finally { bridge.stop(); }
});
