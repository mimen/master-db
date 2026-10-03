import { Database } from "bun:sqlite";
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BBMessage } from "../bb-types";
import { FakeBlueBubbles } from "../bluebubbles-fake";
import { OverlayDb } from "../db";
import { FakeIngest } from "./fake-ingest";
import { MessageWriter } from "./live";
import { ReconcileBridge } from "./reconcile";

const CHAT = "iMessage;-;+15550001111";
const NOW = 2_000_000_000_000;
const config = { dbPath: "/nonexistent/overlay", bbUrl: "http://bb", convexSiteUrl: "http://convex" };
const stops: (() => void)[] = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); });
function fixture() {
  const messages: BBMessage[] = [
    { guid: "old", originalROWID: 1, text: "old", dateCreated: NOW - 25 * 60 * 60_000 },
    { guid: "recent", originalROWID: 2, text: "recent", dateCreated: NOW - 1000, attachments: [{ guid: "a", transferState: 5 }] },
  ];
  const bb = new FakeBlueBubbles({ chats: [{ guid: CHAT, participants: [{ address: "+15550001111" }], messages }] });
  const db = new OverlayDb(":memory:");
  const ingest = new FakeIngest();
  const writer = new MessageWriter({ bb, db, ingest });
  return { bb, db, ingest, writer, messages };
}
function start(writer: MessageWriter) {
  const reconcile = new ReconcileBridge(writer, config, { now: () => NOW, chatDbPath: "/nonexistent/chat.db" });
  stops.push(() => reconcile.stop());
  return reconcile;
}

test("reconcile catches missed live messages and persists only a fully uploaded cursor", async () => {
  const { writer, db, ingest } = fixture();
  const reconcile = start(writer);
  ingest.fail = "attachments";
  const log = spyOn(console, "error").mockImplementation(() => {});
  stops.push(() => log.mockRestore());
  await reconcile.flush();
  expect(reconcile.cursor).toBe(0);
  expect(db.getBridgeCursor("http://convex|http://bb")).toBeNull();
  ingest.fail = null;
  await reconcile.flush();
  expect(reconcile.cursor).toBe(2);
  expect(db.getBridgeCursor("http://convex|http://bb")).toBe(2);
  expect(reconcile.lastReconcileAt).toBe(NOW);
  expect(ingest.calls.filter((call) => call.kind === "messages").at(-1)?.body.messages[0]).toMatchObject({ guid: "recent", conversationId: ingest.id });
  expect(ingest.calls.at(-1)?.body).toEqual({ key: "continuous", cursor: "2", lastReconcileAt: NOW });
});

test("the 24h rescan catches edits and receipts below the cursor, not old history", async () => {
  const { writer, bb, db, ingest } = fixture();
  db.setBridgeCursor("http://convex|http://bb", 2);
  const reconcile = start(writer);
  await reconcile.flush();
  const thread = await bb.chatMessages(CHAT);
  if (!thread.ok) throw new Error(thread.error);
  Object.assign(thread.value.find((message) => message.guid === "recent")!, { text: "edited", dateEdited: NOW, dateRead: NOW });
  ingest.calls.length = 0;
  reconcile.request();
  await reconcile.flush();
  const calls = ingest.calls.filter((call) => call.kind === "messages");
  expect(calls).toHaveLength(1);
  expect(calls[0].body.messages).toMatchObject([{ guid: "recent", text: "edited", sourceVersion: 2002 }]);
  expect(calls[0].body.messages[0].dateRead).toBeGreaterThan(0);
});

test("reconnect after the first connection requests an immediate reconciliation", async () => {
  const { writer, bb } = fixture();
  const reconcile = start(writer);
  await reconcile.flush();
  const before = bb.calls.queryMessages;
  bb.emit({ kind: "stream-connected" });
  await reconcile.flush();
  expect(bb.calls.queryMessages).toBe(before);
  bb.emit({ kind: "stream-connected" });
  await reconcile.flush();
  expect(bb.calls.queryMessages).toBeGreaterThan(before);
});

test("startup resumes the matching backfill checkpoint and inventories orphan ROWIDs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "comma-reconcile-"));
  try {
    const { writer, bb, ingest } = fixture();
    const chatDbPath = join(dir, "chat.db");
    const source = new Database(chatDbPath);
    source.exec("CREATE TABLE message (guid TEXT); INSERT INTO message (ROWID, guid) VALUES (1, 'old'), (2, 'recent'), (3, 'orphan');");
    source.close();
    const dbPath = join(dir, "overlay");
    await Bun.write(`${dbPath}.comma-backfill.json`, JSON.stringify({ siteUrl: config.convexSiteUrl, bbUrl: config.bbUrl, cursor: 2 }));
    const read = bb.messageWithReactions.bind(bb);
    spyOn(bb, "messageWithReactions").mockImplementation((guid) => guid === "orphan"
      ? Promise.resolve({ ok: true, value: [{ guid, originalROWID: 3 }] }) : read(guid));
    const reconcile = new ReconcileBridge(writer, { ...config, dbPath }, { chatDbPath, now: () => NOW });
    expect(reconcile.cursor).toBe(2);
    await reconcile.flush();
    expect(reconcile.cursor).toBe(3);
    reconcile.request();
    await reconcile.flush();
    expect(reconcile.pending).toBe(0);
    expect(ingest.calls.some((call) => call.kind === "messages" && call.body.messages.some((row) => row.guid === "orphan"))).toBe(false);
    reconcile.stop();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
