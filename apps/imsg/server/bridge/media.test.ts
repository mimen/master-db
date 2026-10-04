import { expect, test } from "bun:test";
import { OverlayDb } from "../db";
import { FakeIngest } from "./fake-ingest";
import { MediaWorker } from "./media";

/** A BlueBubbles download stub that serves fixed bytes per guid and records order. */
function bb(files: Record<string, { bytes: number; type: string }>) {
  const downloads: string[] = [];
  return {
    downloads,
    downloadAttachment: (guid: string) => {
      downloads.push(guid);
      const file = files[guid];
      return Promise.resolve(file
        ? new Response(new Uint8Array(file.bytes), { headers: { "Content-Type": file.type } })
        : new Response("missing", { status: 404 }));
    },
  };
}

const row = (guid: string, mimeType: string, extra: Partial<{ isOnDisk: boolean; hideAttachment: boolean }> = {}) => ({
  guid, mimeType, filename: guid, isOnDisk: true, hideAttachment: false, ...extra,
});

test("queues only on-disk, visible attachments", () => {
  const db = new OverlayDb(":memory:");
  const worker = new MediaWorker({ bb: bb({}), db, ingest: new FakeIngest(), pauseMs: 0 });
  worker.enqueue([row("a", "video/mp4"), row("b", "video/mp4", { isOnDisk: false }), row("c", "video/mp4", { hideAttachment: true })], 1);
  expect(db.nextMedia("original", 10).map((item) => item.guid)).toEqual(["a"]);
  worker.stop();
});

test("drains every thumbnail before any original, newest first", async () => {
  const db = new OverlayDb(":memory:");
  const ingest = new FakeIngest();
  const source = bb({ old: { bytes: 10, type: "video/mp4" }, mid: { bytes: 10, type: "video/mp4" }, gif: { bytes: 10, type: "image/gif" } });
  const worker = new MediaWorker({ bb: source, db, ingest, pauseMs: 0 });
  db.enqueueMedia([
    { guid: "old", mimeType: "video/mp4", filename: "old.mp4", createdAt: 1 },
    { guid: "gif", mimeType: "image/gif", filename: "g.gif", createdAt: 3 },
    { guid: "mid", mimeType: "video/mp4", filename: "mid.mp4", createdAt: 2 },
  ]);
  worker.start();
  await worker.flush();
  // Videos have no thumbnail step; the GIF uploads whole as its thumbnail, then originals run newest first.
  expect(source.downloads).toEqual(["gif", "gif", "mid", "old"]);
  const storage: Record<string, string | undefined>[] = ingest.calls.filter((call) => call.kind === "storage").map((call) => call.body);
  expect(storage).toEqual([
    { guid: "gif", thumbStorageId: "storage-1" },
    { guid: "gif", originalStorageId: "storage-2" },
    { guid: "mid", originalStorageId: "storage-3" },
    { guid: "old", originalStorageId: "storage-4" },
  ]);
  expect(worker.counts()).toEqual({ thumbsPending: 0, originalsPending: 0 });
  worker.stop();
});

test("a failed download is retried later, then given up after three attempts", async () => {
  const db = new OverlayDb(":memory:");
  const worker = new MediaWorker({ bb: bb({}), db, ingest: new FakeIngest(), pauseMs: 0 });
  db.enqueueMedia([{ guid: "gone", mimeType: "video/mp4", filename: "gone.mp4", createdAt: 1 }]);
  for (let attempt = 0; attempt < 3; attempt++) {
    worker.start();
    await worker.flush();
  }
  expect(worker.counts().originalsPending).toBe(0);
  expect(worker.lastError).toContain("404");
  worker.stop();
});

test("seeding from Convex queues the backlog, and transcripts copy once", async () => {
  const db = new OverlayDb(":memory:");
  const ingest = new FakeIngest();
  ingest.backlog.push({ guid: "v1", mimeType: "video/mp4", filename: "v1.mp4", createdAt: 5, needsThumb: true, needsOriginal: true });
  db.setAttachmentTranscript("memo-1", "hello there");
  const worker = new MediaWorker({ bb: bb({}), db, ingest, pauseMs: 0 });
  await worker.seedFromConvex();
  await worker.copyTranscripts();
  expect(db.nextMedia("original", 10).map((item) => item.guid)).toEqual(["v1"]);
  expect(ingest.calls.filter((call) => call.kind === "transcript").map((call) => call.body))
    .toEqual([{ attachmentGuid: "memo-1", transcript: "hello there" }]);
  worker.stop();
});

test("publishes new Whisper results after startup and retries failed ingest", async () => {
  const { WhisperService } = await import("../whisper");
  const db = new OverlayDb(":memory:");
  const calls: unknown[] = [];
  let offline = true;
  const ingest = {
    post: async (kind: string, body: unknown) => {
      if (kind !== "media") throw new Error("unexpected ingest kind");
      calls.push(body);
      if (offline) throw new Error("offline");
      return true;
    },
    upload: async () => "unused",
  } as unknown as ConstructorParameters<typeof MediaWorker>[0]["ingest"];
  const worker = new MediaWorker({ bb: bb({}), db, ingest, pauseMs: 0 });
  const { FakeBlueBubbles } = await import("../bluebubbles-fake");
  const service = new WhisperService({ binaryPath: null, modelPath: null, workDir: "/tmp/unused" }, new FakeBlueBubbles({ chats: [] }), db);
  try {
    db.setAttachmentTranscript("new-memo", "newly finished");
    await service.transcribe("new-memo");
    await worker.flush();
    expect(calls.at(-1)).toEqual({ request: { kind: "transcript", attachmentGuid: "new-memo", transcript: { state: "ready", text: "newly finished" } } });
    const failedAttempts = calls.length;
    offline = false;
    await worker.flush();
    expect(calls).toHaveLength(failedAttempts + 1);
    const delivered = calls.length;
    await worker.flush();
    expect(calls).toHaveLength(delivered);
  } finally { worker.stop(); }
});

test("an unmirrored transcript does not block publication for mirrored attachments", async () => {
  const { WhisperService } = await import("../whisper");
  const { FakeBlueBubbles } = await import("../bluebubbles-fake");
  const db = new OverlayDb(":memory:");
  const calls: string[] = [];
  const ingest = {
    post: async (_kind: string, body: { request: { attachmentGuid: string } }) => { calls.push(body.request.attachmentGuid); return body.request.attachmentGuid !== "missing"; },
    upload: async () => "unused",
  } as unknown as ConstructorParameters<typeof MediaWorker>[0]["ingest"];
  const worker = new MediaWorker({ bb: bb({}), db, ingest, pauseMs: 0 });
  const service = new WhisperService({ binaryPath: null, modelPath: null, workDir: "/tmp/unused" }, new FakeBlueBubbles({ chats: [] }), db);
  try {
    for (const guid of ["missing", "present"]) { db.setAttachmentTranscript(guid, "finished"); await service.transcribe(guid); }
    await worker.flush();
    expect(calls).toContain("present");
    const successes = calls.filter((guid) => guid === "present").length;
    await worker.flush();
    expect(calls.filter((guid) => guid === "present")).toHaveLength(successes);
  } finally { worker.stop(); }
});
