import { expect, spyOn, test } from "bun:test";
import { FakeBlueBubbles } from "../bluebubbles-fake";
import { FakeIngest } from "./fake-ingest";
import { ScheduledMirror } from "./scheduled-mirror";

const CHAT = "iMessage;-;+15550001111";

test("startup and changes post full normalized scheduled snapshots, including an empty list", async () => {
  const bb = new FakeBlueBubbles({ chats: [], scheduledMessages: [{ id: 7, type: "send-message",
    payload: { chatGuid: CHAT, message: "hello", method: "private-api" },
    scheduledFor: "2030-01-01T00:00:00Z", schedule: { type: "once" }, status: "error", error: "server restarted", sentAt: null }] });
  const ingest = new FakeIngest();
  const mirror = new ScheduledMirror(bb, ingest);
  try {
    await mirror.flush();
    expect(ingest.calls.at(-1)).toEqual({ kind: "scheduled", body: { items: [{ bbId: 7, chatGuid: CHAT,
      text: "hello", sendAt: Date.parse("2030-01-01T00:00:00Z"), status: "interrupted", error: "server restarted", sentAt: undefined }] } });
    await bb.updateScheduledMessage(7, CHAT, "edited", 500);
    mirror.request();
    await mirror.flush();
    expect(ingest.calls.at(-1)?.body).toMatchObject({ items: [{ text: "edited", sendAt: 500 }] });
    await bb.deleteScheduledMessage(7);
    mirror.request();
    await mirror.flush();
    expect(ingest.calls.at(-1)).toEqual({ kind: "scheduled", body: { items: [] } });
  } finally { mirror.stop(); }
});

test("a failed scheduled fetch never replaces Convex with an empty snapshot", async () => {
  const bb = new FakeBlueBubbles({ chats: [] });
  const read = spyOn(bb, "listScheduledMessages").mockResolvedValueOnce({ ok: false, error: "offline" });
  const log = spyOn(console, "error").mockImplementation(() => {});
  const ingest = new FakeIngest();
  const mirror = new ScheduledMirror(bb, ingest);
  try {
    await mirror.flush();
    expect(ingest.calls).toEqual([]);
    expect(mirror.pending).toBe(1);
    await mirror.flush();
    expect(ingest.calls).toEqual([{ kind: "scheduled", body: { items: [] } }]);
  } finally { mirror.stop(); read.mockRestore(); log.mockRestore(); }
});
