import { expect, test } from "bun:test";
import type { ConvexClient } from "convex/browser";
import { ChatCommands } from "../commands";
import { ChatDirectory } from "../chat-directory";
import { ContactBook } from "../contacts";
import { FakeBlueBubbles } from "../bluebubbles-fake";
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
  const start = () => new OutboxBridge({
    config: { convexCloudUrl: "https://convex.test", commaBridgeSecret: "test" },
    writer, commands, client, now: () => now,
  });
  return { bb, db, ingest, writer, start, fire };
}

function row(clientKey: string, payload: OutboxRow["payload"], now = 1_000): OutboxRow {
  return {
    _id: `row-${clientKey}`, _creationTime: now, clientKey, conversationId: "conversation-test",
    payload, status: "claimed", attempts: 1, leaseUntil: now + 60_000, createdAt: now, updatedAt: now,
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
