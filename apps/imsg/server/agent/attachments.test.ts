import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userContent } from "./attachments";

const root = mkdtempSync(join(tmpdir(), "comma-attachments-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const file = (url: string | null, filename: string, mimeType: string) => ({ url, filename, mimeType, size: 0 });

describe("userContent", () => {
  test("a message without attachments stays plain text", async () => {
    expect(await userContent("hi", [], { fetch: async () => { throw new Error("no fetch"); }, dir: root })).toBe("hi");
  });

  test("keeps same-named files apart, names a lost file, and sends an oversized image by path only", async () => {
    const dir = join(root, "m1");
    const bodies: Record<string, string | Uint8Array> = { a: "first", b: "second", big: new Uint8Array(5 * 1024 * 1024 + 1) };
    const content = await userContent("", [
      file("a", "notes.txt", "text/plain"), file("b", "notes.txt", "text/plain"), file(null, "gone.pdf", "application/pdf"),
      file("big", "huge.png", "image/png"),
    ], { fetch: async (url) => new Response(bodies[url]), dir });
    expect(content).toEqual([{
      type: "text",
      text: [
        `[Attached file "notes.txt" is saved at: ${dir}/notes.txt]`, `[Attached file "notes.txt" is saved at: ${dir}/2-notes.txt]`,
        `[Attached file "gone.pdf" is no longer stored]`, `[Attached file "huge.png" is saved at: ${dir}/huge.png]`,
      ].join("\n\n"),
    }]);
    expect([await Bun.file(join(dir, "notes.txt")).text(), await Bun.file(join(dir, "2-notes.txt")).text()]).toEqual(["first", "second"]);
  });

  test("a failed download fails the message instead of sending it without the file", async () => {
    await expect(userContent("look", [file("x", "a.png", "image/png")], { fetch: async () => new Response("", { status: 403 }), dir: join(root, "m2") }))
      .rejects.toThrow("Downloading a.png failed: HTTP 403");
  });
});
