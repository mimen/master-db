import { afterEach, expect, spyOn, test } from "bun:test";
import { FakeBlueBubbles } from "../bluebubbles-fake";
import { OverlayDb } from "../db";
import { FakeIngest } from "./fake-ingest";
import { MessageWriter } from "./live";
import { OverlayMirror } from "./overlay-mirror";

const CHAT = "iMessage;-;+15550001111";
const SIBLING = "SMS;-;+15550001111";
const stops: (() => void)[] = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); });
function fixture() {
  const db = new OverlayDb(":memory:");
  const ingest = new FakeIngest();
  const bb = new FakeBlueBubbles({ chats: [CHAT, SIBLING].map((guid) => ({ guid, participants: [{ address: "+15550001111" }], messages: [] })) });
  const writer = new MessageWriter({ bb, db, ingest });
  return { db, ingest, writer };
}

test("startup imports all overlay tables, keeping siblings in the same snapshot", async () => {
  const { db, writer, ingest } = fixture();
  db.setPinned(CHAT, true);
  db.setReadAt(SIBLING, 123);
  db.recordTriageClear(CHAT, "m1", "reply", 50);
  db.setOpenTriageItem(SIBLING, "m2", 60);
  const mirror = new OverlayMirror(writer);
  stops.push(() => mirror.stop());
  await mirror.flush();
  const call = ingest.calls.find((call) => call.kind === "overlay");
  expect(call?.body).toMatchObject({
    replaceChatGuids: [CHAT, SIBLING],
    chatState: [{ chatGuid: CHAT, pinned: true }, { chatGuid: SIBLING, pinned: false, readAt: 123 }],
    triageEvents: [{ chatGuid: CHAT, messageGuid: "m1", reason: "reply", clearedAt: 50 }],
    triageOpen: [{ chatGuid: SIBLING, messageGuid: "m2", openedAt: 60 }],
  });
  ingest.calls.length = 0;
  db.setMarkedUnread(SIBLING, true);
  await mirror.flush();
  expect(ingest.calls).toHaveLength(1);
  expect(ingest.calls[0].body).toMatchObject({ chatState: [{ pinned: true }, { markedUnread: true }] });
});

test("every overlay write posts current state, including removals and mute", async () => {
  const { db, writer, ingest } = fixture();
  const mirror = new OverlayMirror(writer);
  stops.push(() => mirror.stop());
  await mirror.flush();
  ingest.calls.length = 0;
  const writes = [
    () => db.setPinned(CHAT, true), () => db.setReadAt(CHAT, 10),
    () => db.setMarkedUnread(CHAT, true), () => db.setMarkedUnread(CHAT, false),
    () => db.dismissUnresponded(CHAT, "m1"), () => db.dismissWaiting(CHAT, "m2"),
    () => db.clearDismissal(CHAT, "unresponded"), () => db.clearDismissal(CHAT, "waiting"),
    () => db.setMutedUnresponded(CHAT, true), () => db.setOpenTriageItem(CHAT, "m3", 30),
    () => db.recordTriageClear(CHAT, "m3", "dismiss", 40),
    () => db.clearOpenTriageItem(CHAT), () => db.deleteTriageClear(CHAT, "m3"),
  ];
  for (const write of writes) { write(); await mirror.flush(); }
  expect(ingest.calls.filter((call) => call.kind === "overlay")).toHaveLength(writes.length);
  expect(ingest.calls.at(-1)?.body).toMatchObject({ replaceChatGuids: [CHAT],
    chatState: [{ pinned: true, readAt: 10, markedUnread: false, mutedUnresponded: true,
      dismissedUnrespondedGuid: undefined, dismissedWaitingGuid: undefined }], triageEvents: [], triageOpen: [] });
});

test("overlay failures never interrupt writes and retain a snapshot retry", async () => {
  const { db, writer, ingest } = fixture();
  const log = spyOn(console, "error").mockImplementation(() => {});
  const mirror = new OverlayMirror(writer);
  stops.push(() => { mirror.stop(); log.mockRestore(); });
  await mirror.flush();
  ingest.fail = "overlay";
  expect(() => db.setPinned(CHAT, true)).not.toThrow();
  await mirror.flush();
  expect(mirror.pending).toBeGreaterThan(0);
  ingest.fail = null;
  db.setPinned(CHAT, false);
  await mirror.flush();
  expect(ingest.calls.at(-1)?.body).toMatchObject({ chatState: [{ pinned: false }] });
  expect(mirror.pending).toBe(0);
  const unsubscribe = db.onOverlayChange(() => { throw new Error("listener failed"); });
  expect(() => db.setReadAt(CHAT, 1)).not.toThrow();
  unsubscribe();
});

test("removing the final open item still sends an empty scoped snapshot", async () => {
  const { db, writer, ingest } = fixture();
  db.setOpenTriageItem(CHAT, "m1", 1);
  const mirror = new OverlayMirror(writer);
  stops.push(() => mirror.stop());
  await mirror.flush();
  db.clearOpenTriageItem(CHAT);
  await mirror.flush();
  expect(ingest.calls.at(-1)?.body).toEqual({ replaceChatGuids: [CHAT], chatState: [], triageEvents: [], triageOpen: [] });
});
