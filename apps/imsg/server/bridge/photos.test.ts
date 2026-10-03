import { expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OverlayDb } from "../db";
import { FakeIngest } from "./fake-ingest";
import { PhotoMirror } from "./photos";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "comma-photos-"));
  const dbPath = join(directory, "overlay.db");
  const db = new OverlayDb(dbPath);
  const ingest = new FakeIngest();
  return { directory, dbPath, db, ingest };
}

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

test("startup uploads photos with SHA-256 and MIME types, persists hashes, and uploads only changes", async () => {
  const { directory, dbPath, db, ingest } = await fixture();
  await Bun.write(join(directory, "6195551234.img"), jpeg);
  await Bun.write(join(directory, "person@example.com.img"), png);
  await Bun.write(join(directory, ".tmp-photo.jpg"), jpeg);
  await mkdir(join(directory, "not-a-file.img"));
  const mirror = new PhotoMirror(db, ingest, directory);
  try {
    await mirror.flush();
    expect(mirror.uploaded).toBe(2);
    expect(mirror.pending).toBe(0);
    expect(ingest.uploads.map((row) => row.contentType).sort()).toEqual(["image/jpeg", "image/png"]);
    expect(ingest.calls.find((call) => call.kind === "photo" && call.body.address === "6195551234")).toMatchObject({ kind: "photo", body: {
      address: "6195551234", storageId: db.getBridgePhoto("6195551234")!.storageId, hash: createHash("sha256").update(jpeg).digest("hex"),
    } });
    mirror.request();
    await mirror.flush();
    expect(ingest.uploads).toHaveLength(2);
    expect(ingest.calls).toHaveLength(2);
    mirror.stop();
    const restarted = new PhotoMirror(new OverlayDb(dbPath), ingest, directory);
    try {
      await restarted.flush();
      expect(ingest.uploads).toHaveLength(2);
      await Bun.write(join(directory, "6195551234.img"), png);
      restarted.request();
      await restarted.flush();
      expect(ingest.uploads).toHaveLength(3);
      expect(ingest.calls.at(-1)).toMatchObject({ kind: "photo", body: {
        address: "6195551234", storageId: "storage-3", hash: createHash("sha256").update(png).digest("hex"),
      } });
    } finally { restarted.stop(); }
  } finally { mirror.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("failed linking retries the persisted storage ID after a restart without uploading twice", async () => {
  const { directory, dbPath, db, ingest } = await fixture();
  await Bun.write(join(directory, "6195551234.img"), jpeg);
  ingest.fail = "photo";
  const log = spyOn(console, "error").mockImplementation(() => {});
  const mirror = new PhotoMirror(db, ingest, directory);
  try {
    await mirror.flush();
    expect(mirror.pending).toBe(1);
    expect(db.getBridgePhoto("6195551234")).toMatchObject({ matched: 0, storageId: "storage-1" });
    mirror.stop();
    ingest.fail = null;
    const restarted = new PhotoMirror(new OverlayDb(dbPath), ingest, directory);
    try {
      await restarted.flush();
      expect(restarted.pending).toBe(0);
      expect(ingest.uploads).toHaveLength(1);
      expect(ingest.calls).toHaveLength(2);
      expect(ingest.calls[1]).toEqual(ingest.calls[0]);
      expect(db.getBridgePhoto("6195551234")).toMatchObject({ matched: 1 });
    } finally { restarted.stop(); }
  } finally { mirror.stop(); log.mockRestore(); await rm(directory, { recursive: true, force: true }); }
});

test("unmatched addresses retry association on later scans without re-uploading", async () => {
  const { directory, db, ingest } = await fixture();
  await Bun.write(join(directory, "unknown@example.com.img"), jpeg);
  const post = spyOn(ingest, "post").mockResolvedValueOnce(false);
  const mirror = new PhotoMirror(db, ingest, directory);
  try {
    await mirror.flush();
    expect(mirror.pending).toBe(1);
    expect(mirror.uploaded).toBe(1);
    mirror.request();
    await mirror.flush();
    expect(mirror.pending).toBe(0);
    expect(ingest.uploads).toHaveLength(1);
    expect(db.getBridgePhoto("unknown@example.com")).toMatchObject({ matched: 1 });
    mirror.stop();
    mirror.request();
    await mirror.flush();
    expect(ingest.uploads).toHaveLength(1);
  } finally { mirror.stop(); post.mockRestore(); await rm(directory, { recursive: true, force: true }); }
});

test("a missing avatar cache is an empty scan", async () => {
  const { directory, db, ingest } = await fixture();
  const mirror = new PhotoMirror(db, ingest, join(directory, "absent"));
  try {
    await mirror.flush();
    expect(mirror.pending).toBe(0);
    expect(mirror.uploaded).toBe(0);
    expect(ingest.calls).toEqual([]);
  } finally { mirror.stop(); await rm(directory, { recursive: true, force: true }); }
});
