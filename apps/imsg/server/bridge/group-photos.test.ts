import { expect, spyOn, test } from "bun:test";
import type { BBChat } from "../bb-types";
import { OverlayDb } from "../db";
import { FakeBlueBubbles } from "../bluebubbles-fake";
import { FakeIngest } from "./fake-ingest";
import { GroupPhotoMirror } from "./group-photos";
import { LiveBridge, MessageWriter } from "./live";

const group = (guid: string | null): BBChat => ({ guid: "iMessage;+;friends", participants: [{ address: "+16195551234" }], properties: [{ groupPhotoGuid: guid }] });
const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
function fixture() {
  const db = new OverlayDb(":memory:");
  const ingest = new FakeIngest();
  const downloaded: string[] = [];
  const bb = { downloadAttachment: async (guid: string) => { downloaded.push(guid); return new Response(bytes); } };
  return { db, ingest, downloaded, bb, mirror: new GroupPhotoMirror(bb, db, ingest) };
}

test("uploads only changed group photo GUIDs, including across restarts, and clears removal", async () => {
  const { db, bb, ingest, downloaded, mirror } = fixture();
  let restarted: GroupPhotoMirror | undefined;
  try {
    mirror.observe([group("p1"), { guid: "iMessage;-;+16195551234", properties: [{ groupPhotoGuid: "dm-photo" }] }]);
    await mirror.flush();
    expect(downloaded).toEqual(["p1"]);
    expect(ingest.uploads).toEqual([{ bytes: 4, contentType: "image/png" }]);
    expect(ingest.calls).toMatchObject([{ kind: "groupPhoto", body: { guid: "p1", storageId: "storage-1", chatGuid: "iMessage;+;friends" } }]);
    mirror.observe([group("p1")]);
    await mirror.flush();
    mirror.stop();
    restarted = new GroupPhotoMirror(bb, db, ingest);
    restarted.observe([group("p1")]);
    await restarted.flush();
    expect(downloaded).toEqual(["p1"]);
    expect(ingest.calls).toHaveLength(1);
    restarted.observe([group("p2")]);
    await restarted.flush();
    expect(downloaded).toEqual(["p1", "p2"]);
    restarted.observe([group(null)]);
    await restarted.flush();
    expect(ingest.calls.at(-1)).toMatchObject({ kind: "groupPhoto", body: { guid: null } });
    restarted.observe([group(null)]);
    await restarted.flush();
    expect(ingest.calls).toHaveLength(3);
  } finally { mirror.stop(); restarted?.stop(); }
});

test("retries linking the stored upload after an ingest failure without downloading again", async () => {
  const { db, bb, ingest, downloaded, mirror } = fixture();
  const log = spyOn(console, "error").mockImplementation(() => {});
  let restarted: GroupPhotoMirror | undefined;
  try {
    ingest.fail = "groupPhoto";
    mirror.observe([group("p1")]);
    await mirror.flush();
    mirror.stop();
    ingest.fail = null;
    restarted = new GroupPhotoMirror(bb, db, ingest);
    restarted.observe([group("p1")]);
    await restarted.flush();
    expect(downloaded).toEqual(["p1"]);
    expect(ingest.uploads).toHaveLength(1);
    expect(ingest.calls).toHaveLength(2);
    expect(ingest.calls[1]).toEqual(ingest.calls[0]);
  } finally { mirror.stop(); restarted?.stop(); log.mockRestore(); }
});

test("startup and group-change events mirror photos after conversations are ingested", async () => {
  const db = new OverlayDb(":memory:");
  const bb = new FakeBlueBubbles({ chats: [{ ...group("p1"), messages: [] }] });
  const download = spyOn(bb, "downloadAttachment").mockImplementation(async () => new Response(bytes));
  const chats = spyOn(bb, "queryChats").mockResolvedValue({ ok: true, value: [group("p1")] });
  const ingest = new FakeIngest();
  const writer = new MessageWriter({ bb, db, ingest });
  const mirror = new GroupPhotoMirror(bb, db, ingest);
  writer.onChats = (chats) => mirror.observe(chats);
  const live = new LiveBridge(writer);
  try {
    await live.flush();
    await mirror.flush();
    expect(ingest.calls.map((call) => call.kind)).toEqual(["conversations", "groupPhoto"]);
    chats.mockResolvedValue({ ok: true, value: [group("p2")] });
    bb.emit({ kind: "group-changed" });
    await live.flush();
    await mirror.flush();
    expect(ingest.calls.map((call) => call.kind)).toEqual(["conversations", "groupPhoto", "groupPhoto"]);
    expect(ingest.calls.at(-1)).toMatchObject({ body: { guid: "p2" } });
  } finally { live.stop(); mirror.stop(); download.mockRestore(); chats.mockRestore(); }
});
