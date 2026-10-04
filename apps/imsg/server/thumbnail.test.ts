import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { downloadFailureReason } from "./bluebubbles";
import { canThumbnail, thumbnailAttachment } from "./thumbnail";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function cacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "imsg-thumb-"));
  dirs.push(dir);
  return dir;
}

function png(width: number, height: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (1 + width * 3)).map((_, i) => (i % (1 + width * 3) === 0 ? 0 : (i * 7) % 251));
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}

async function dimensions(path: string): Promise<[number, number]> {
  const out = await new Response(Bun.spawn(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path]).stdout).text();
  const [w, h] = [...out.matchAll(/: (\d+)/g)].map((m) => Number(m[1]));
  return [w!, h!];
}

describe("thumbnail eligibility", () => {
  test("keeps GIFs whole and skips non-images", () => {
    expect(canThumbnail("image/gif", "tmp.gif")).toBe(false);
    expect(canThumbnail("image/heic", "IMG_1.HEIC")).toBe(true);
    expect(canThumbnail("video/mp4", "a.mp4")).toBe(false);
    expect(canThumbnail(null, "photo.PNG")).toBe(true);
  });
});

describe("thumbnailAttachment", () => {
  test("downscales a large image to a cached JPEG and reuses the cache", async () => {
    const dir = cacheDir();
    let downloads = 0;
    const download = () => {
      downloads++;
      return Promise.resolve(new Response(png(1200, 800)));
    };

    const first = await thumbnailAttachment("at_0_ABC", 520, download, dir);
    expect(first).toEqual({ ok: true, path: join(dir, "at_0_ABC.w520.jpg") });
    if (!first.ok) throw new Error("unreachable");
    expect(await dimensions(first.path)).toEqual([520, 346]);
    const bytes = new Uint8Array(await Bun.file(first.path).arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

    expect(await thumbnailAttachment("at_0_ABC", 520, download, dir)).toEqual(first);
    expect(downloads).toBe(1);
    expect(readdirSync(dir)).toEqual(["at_0_ABC.w520.jpg"]);
  });

  test("never upscales a small image", async () => {
    const dir = cacheDir();
    const result = await thumbnailAttachment("small", 1040, () => Promise.resolve(new Response(png(100, 50))), dir);
    if (!result.ok) throw new Error(result.reason);
    expect(await dimensions(result.path)).toEqual([100, 50]);
  });

  test("shares one download between concurrent requests", async () => {
    const dir = cacheDir();
    let downloads = 0;
    const download = () => {
      downloads++;
      return Promise.resolve(new Response(png(800, 600)));
    };
    const [a, b] = await Promise.all([
      thumbnailAttachment("same", 260, download, dir),
      thumbnailAttachment("same", 260, download, dir),
    ]);
    expect(a).toEqual(b);
    expect(downloads).toBe(1);
  });

  test("reports BlueBubbles' reason when the original is not on disk", async () => {
    const dir = cacheDir();
    const body = { status: 500, message: "The server has encountered an error", error: { type: "Server Error", message: "Attachment does not exist in disk!" } };
    const result = await thumbnailAttachment("gone", 520, () => Promise.resolve(Response.json(body, { status: 500 })), dir);
    expect(result).toEqual({ ok: false, reason: "BlueBubbles 500: Attachment does not exist in disk!" });
    expect(readdirSync(dir)).toEqual([]);
  });

  test("fails cleanly on bytes that are not an image", async () => {
    const dir = cacheDir();
    const result = await thumbnailAttachment("junk", 520, () => Promise.resolve(new Response("not an image")), dir);
    expect(result).toEqual({ ok: false, reason: "not a readable image" });
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("downloadFailureReason", () => {
  test("falls back to the raw body and status", async () => {
    expect(await downloadFailureReason(new Response("upstream down", { status: 503 }))).toBe("BlueBubbles 503: upstream down");
    expect(await downloadFailureReason(new Response(null, { status: 404 }))).toBe("BlueBubbles 404");
  });
});
