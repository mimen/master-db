import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userContent, type UserContent } from "./attachments";

const root = mkdtempSync(join(tmpdir(), "comma-attachments-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const file = (url: string | null, filename: string, mimeType: string, size = 0) => ({ url, filename, mimeType, size });

const sips = (...args: string[]) => {
  const run = Bun.spawnSync(["sips", ...args]);
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return run.stdout.toString();
};
const fixture = (name: string) => readFileSync(join(root, name));
writeFileSync(join(root, "dot.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
sips("-z", "1500", "3000", join(root, "dot.png"), "--out", join(root, "wide.png"));
sips("-s", "format", "jpeg", join(root, "dot.png"), "--out", join(root, "dot.jpg"));
const padded = (bytes: Uint8Array) => Buffer.concat([bytes, new Uint8Array(4 * 1024 * 1024)]);
// Random pixels do not compress, so this PNG stays over 3.75 MB at 2000px wide.
function noiseBmp(width: number, height: number): Buffer {
  const header = Buffer.alloc(54);
  header.write("BM", 0);
  header.writeUInt32LE(54 + width * height * 3, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  return Buffer.concat([header, randomBytes(width * height * 3)]);
}
writeFileSync(join(root, "noise.bmp"), noiseBmp(2000, 800));
sips("-s", "format", "png", join(root, "noise.bmp"), "--out", join(root, "noise.png"));

type Block = Exclude<UserContent, string>[number];
const images = (content: UserContent) => (typeof content === "string" ? [] : content).flatMap((block: Block) =>
  block.type === "image" && block.source.type === "base64" ? [{ type: block.source.media_type, bytes: Buffer.from(block.source.data, "base64") }] : []);
function dims(bytes: Buffer): [number, number] {
  const path = join(root, `probe-${crypto.randomUUID()}`);
  writeFileSync(path, bytes);
  const out = sips("-g", "pixelWidth", "-g", "pixelHeight", path);
  return [Number(/pixelWidth: (\d+)/.exec(out)?.[1]), Number(/pixelHeight: (\d+)/.exec(out)?.[1])];
}
const serve = (bodies: Record<string, string | Uint8Array>) => async (url: string) => new Response(bodies[url]);

describe("userContent", () => {
  test("a message without attachments stays plain text", async () => {
    expect(await userContent("hi", [], { fetch: async () => { throw new Error("no fetch"); }, dir: root })).toBe("hi");
  });

  test("keeps same-named files apart, names a lost file, and sends unreadable image bytes by path only", async () => {
    const dir = join(root, "m1");
    const content = await userContent("", [
      file("a", "notes.txt", "text/plain"), file("b", "notes.txt", "text/plain"), file(null, "gone.pdf", "application/pdf"),
      file("big", "huge.png", "image/png"),
    ], { fetch: serve({ a: "first", b: "second", big: new Uint8Array(5 * 1024 * 1024 + 1) }), dir });
    expect(content).toEqual([{
      type: "text",
      text: [
        `[Attached file "notes.txt" is saved at: ${dir}/notes.txt]`, `[Attached file "notes.txt" is saved at: ${dir}/2-notes.txt]`,
        `[Attached file "gone.pdf" is no longer stored]`, `[Attached file "huge.png" is saved at: ${dir}/huge.png]`,
      ].join("\n\n"),
    }]);
    expect([await Bun.file(join(dir, "notes.txt")).text(), await Bun.file(join(dir, "2-notes.txt")).text()]).toEqual(["first", "second"]);
  });

  test("an image over a 2000px edge reaches the model fitted, and the full-size original stays on disk", async () => {
    const dir = join(root, "m3");
    const content = await userContent("look", [file("w", "wide.png", "image/png")], { fetch: serve({ w: fixture("wide.png") }), dir });
    const [image] = images(content);
    expect(image?.type).toBe("image/png");
    expect(dims(image!.bytes)).toEqual([2000, 1000]);
    expect(dims(readFileSync(join(dir, "wide.png")))).toEqual([3000, 1500]);
  });

  test("an image over 3.75 MB within the edge reaches the model under 3.75 MB", async () => {
    const content = await userContent("", [file("p", "heavy.png", "image/png")], { fetch: serve({ p: padded(fixture("dot.png")) }), dir: join(root, "m4") });
    const [image] = images(content);
    expect(image).toBeDefined();
    expect(image!.bytes.byteLength).toBeLessThanOrEqual(3.75 * 1024 * 1024);
    expect(dims(image!.bytes)).toEqual([1, 1]);
  });

  test("an image still over 3.75 MB at the edge is re-encoded as JPEG", async () => {
    expect(fixture("noise.png").byteLength).toBeGreaterThan(3.75 * 1024 * 1024);
    const content = await userContent("", [file("n", "noise.png", "image/png")], { fetch: serve({ n: fixture("noise.png") }), dir: join(root, "m8") });
    const [image] = images(content);
    expect(image?.type).toBe("image/jpeg");
    expect(image!.bytes.byteLength).toBeLessThanOrEqual(3.75 * 1024 * 1024);
    expect(dims(image!.bytes)).toEqual([2000, 800]);
  });

  test("an image that cannot be processed goes by path, never as a block", async () => {
    const dir = join(root, "m5");
    const broken = padded(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
    const content = await userContent("", [file("x", "broken.png", "image/png")], { fetch: serve({ x: broken }), dir });
    expect(content).toEqual([{ type: "text", text: `[Attached file "broken.png" is saved at: ${dir}/broken.png]` }]);
  });

  test("the block carries the sniffed type, and content that is not one of the four image types goes by path", async () => {
    const dir = join(root, "m6");
    const content = await userContent("", [
      file("jpeg", "photo.png", "image/png"), file("text", "fake.png", "image/png"), file("png", "data.bin", "application/octet-stream"),
    ], { fetch: serve({ jpeg: fixture("dot.jpg"), text: "not an image", png: fixture("dot.png") }), dir });
    expect(images(content).map((image) => image.type)).toEqual(["image/jpeg"]);
    expect(content).toMatchObject([{ type: "image" }, {
      type: "text",
      text: [
        `[Attached image "photo.png" is saved at: ${dir}/photo.png]`, `[Attached file "fake.png" is saved at: ${dir}/fake.png]`,
        `[Attached file "data.bin" is saved at: ${dir}/data.bin]`,
      ].join("\n\n"),
    }]);
  });

  test("a file over 100 MB is skipped with a note and never downloaded", async () => {
    const content = await userContent("see", [file("huge", "video.mov", "video/quicktime", 100 * 1024 * 1024 + 1)], {
      fetch: async () => { throw new Error("downloaded"); }, dir: join(root, "m7"),
    });
    expect(content).toEqual([{ type: "text", text: `see\n\n[Attached file "video.mov" is over the 100 MB limit and was not downloaded]` }]);
  });

  test("a failed download fails the message instead of sending it without the file", async () => {
    await expect(userContent("look", [file("x", "a.png", "image/png")], { fetch: async () => new Response("", { status: 403 }), dir: join(root, "m2") }))
      .rejects.toThrow("Downloading a.png failed: HTTP 403");
  });
});
