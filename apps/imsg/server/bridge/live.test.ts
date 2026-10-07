import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BBMessage } from "../bb-types";
import { FakeBlueBubbles } from "../bluebubbles-fake";
import { OverlayDb } from "../db";
import { FakeIngest } from "./fake-ingest";
import { LiveBridge, MessageWriter } from "./live";

const CHAT = "iMessage;-;+15550001111";
const stops: (() => void)[] = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); });

export function fixture(db = new OverlayDb(":memory:")) {
  const raw: BBMessage = { guid: "m1", originalROWID: 8, text: "hello", dateCreated: Date.now(),
    attachments: [{ guid: "a1", transferState: 5 }], chats: [{ guid: CHAT }] };
  const bb = new FakeBlueBubbles({ chats: [{ guid: CHAT, participants: [{ address: "+15550001111" }], messages: [raw] }] });
  const ingest = new FakeIngest();
  const writer = new MessageWriter({ bb, db, ingest });
  return { raw, bb, db, ingest, writer, chatGuid: CHAT };
}

test("new messages use warmed conversation ids, batch bursts and preserve the existing listener", async () => {
  const { raw, bb, ingest, writer } = fixture();
  let existingEvents = 0;
  const unsubscribe = bb.onEvent(() => existingEvents++);
  const live = new LiveBridge(writer);
  stops.push(() => { live.stop(); unsubscribe(); });
  await live.flush();
  ingest.calls.length = 0;
  bb.emit({ kind: "new-message", message: raw });
  bb.emit({ kind: "new-message", message: raw });
  await Bun.sleep(150);
  const calls = ingest.calls.filter((call) => call.kind === "messages");
  expect(calls).toHaveLength(1);
  expect(calls[0].body.messages).toMatchObject([{ guid: "m1", conversationId: ingest.id, sourceVersion: 8001 }]);
  expect(ingest.calls.find((call) => call.kind === "attachments")?.body).toMatchObject({ attachments: [{ guid: "a1", sourceVersion: 8001 }] });
  expect(existingEvents).toBe(2);
  expect(live.pending).toBe(0);
});

test("updates increase durable versions across restarts, identical retries keep their version", async () => {
  const dir = await mkdtemp(join(tmpdir(), "comma-version-"));
  try {
    const path = join(dir, "overlay.db");
    const first = fixture(new OverlayDb(path));
    const live = new LiveBridge(first.writer);
    await live.flush();
    first.bb.emit({ kind: "new-message", message: first.raw });
    await live.flush();
    live.stop();
    const next = fixture(new OverlayDb(path));
    const restarted = new LiveBridge(next.writer);
    stops.push(() => restarted.stop());
    await restarted.flush();
    const update = { ...next.raw, text: "edited", dateEdited: Date.now(), dateRead: Date.now() };
    next.bb.emit({ kind: "updated-message", message: update });
    await restarted.flush();
    next.bb.emit({ kind: "updated-message", message: update });
    await restarted.flush();
    expect(next.ingest.calls.filter((call) => call.kind === "messages").map((call) =>
      call.body.messages[0].sourceVersion)).toEqual([8002, 8002]);
    for (let i = 0; i < 1001; i++) next.db.bridgeVersion("many", String(i), 1000);
    expect(next.db.bridgeVersion("many", "last", 1000)).toBe(2002);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("unknown chats resolve before messages and group changes re-upsert conversations", async () => {
  const { raw, bb, ingest, writer } = fixture();
  const query = spyOn(bb, "queryChats").mockResolvedValueOnce({ ok: true, value: [] });
  const live = new LiveBridge(writer);
  stops.push(() => live.stop());
  await live.flush();
  bb.emit({ kind: "new-message", message: raw });
  await live.flush();
  expect(ingest.calls.map((call) => call.kind)).toEqual(["conversations", "messages", "attachments", "sync"]);
  const reads = bb.calls.queryChats;
  bb.emit({ kind: "group-changed" });
  await live.flush();
  expect(bb.calls.queryChats).toBe(reads + 1);
  query.mockRestore();
});

test("send errors are mirrored and failed ingest retains the batch without throwing", async () => {
  const { raw, bb, ingest, writer } = fixture();
  const log = spyOn(console, "error").mockImplementation(() => {});
  const live = new LiveBridge(writer);
  stops.push(() => { live.stop(); log.mockRestore(); });
  await live.flush();
  ingest.fail = "messages";
  expect(() => bb.emit({ kind: "message-send-error", message: { guid: raw.guid, error: 42 } })).not.toThrow();
  await live.flush();
  expect(live.pending).toBeGreaterThan(0);
  ingest.fail = null;
  await live.flush();
  const calls = ingest.calls.filter((call) => call.kind === "messages");
  expect(calls.map((call) => call.body.messages[0].sourceVersion)).toEqual([8001, 8001]);
  expect(calls.at(-1)?.body.messages[0]).toMatchObject({ error: 42, text: "hello", attachmentGuids: ["a1"] });
  expect(live.pending).toBe(0);
});

test("a refresh posts only the conversations that changed", async () => {
  const { writer, bb, ingest, chatGuid } = fixture();
  await writer.refreshChats();
  await writer.refreshChats();
  expect(ingest.calls.filter((call) => call.kind === "conversations")).toHaveLength(1);
  bb.appendMessage(chatGuid, { guid: "m2", originalROWID: 9, text: "later", dateCreated: Date.now() + 1000, chats: [{ guid: chatGuid }] });
  await writer.refreshChats();
  const posts = ingest.calls.filter((call) => call.kind === "conversations");
  expect(posts).toHaveLength(2);
  expect(posts[1].body.conversations.map((row) => row.lastMessage?.text)).toEqual(["later"]);
});

test("message and attachment batches never exceed 200 rows", async () => {
  const { writer, raw, ingest } = fixture();
  await writer.refreshChats();
  await writer.postMessages(Array.from({ length: 205 }, (_, i) => ({ ...raw, guid: `batch-${i}`, originalROWID: i + 1,
    attachments: [{ guid: `file-${i}`, transferState: 5 }] })));
  expect(ingest.calls.filter((call) => call.kind === "messages").map((call) => call.body.messages.length)).toEqual([200, 5]);
  expect(ingest.calls.filter((call) => call.kind === "attachments").map((call) => call.body.attachments.length)).toEqual([200, 5]);
});

test("a group change during a refresh is not lost", async () => {
  const { writer, bb } = fixture();
  const live = new LiveBridge(writer);
  stops.push(() => live.stop());
  await live.flush();
  const original = bb.queryChats.bind(bb);
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const read = spyOn(bb, "queryChats").mockImplementationOnce(async () => {
    await blocked;
    return original();
  });
  bb.emit({ kind: "group-changed" });
  const flushing = live.flush();
  await Bun.sleep(5);
  bb.emit({ kind: "group-changed" });
  release();
  await flushing;
  expect(read).toHaveBeenCalledTimes(2);
  read.mockRestore();
});
