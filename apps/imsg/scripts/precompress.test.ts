import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { precompress } from "./precompress";

describe("precompress", () => {
  test("writes round-trippable br and gz siblings for compressible assets only", async () => {
    const root = mkdtempSync(join(tmpdir(), "comma-precompress-"));
    try {
      const js = join(root, "_expo/static/js/web/entry-abc.js");
      const font = join(root, "assets/fonts/Inter.ttf");
      const woff = join(root, "assets/fonts/Inter.woff");
      const woff2 = join(root, "assets/fonts/Inter.woff2");
      const png = join(root, "favicon.png");
      mkdirSync(join(root, "_expo/static/js/web"), { recursive: true });
      mkdirSync(join(root, "assets/fonts"), { recursive: true });
      const source = "console.log('comma');\n".repeat(500);
      writeFileSync(js, source);
      writeFileSync(join(root, "index.html"), "<!doctype html><html></html>");
      writeFileSync(font, new Uint8Array([0, 1, 0, 0, 7, 7, 7, 7]));
      writeFileSync(woff, "wOFF".repeat(64));
      writeFileSync(woff2, "wOF2".repeat(64));
      writeFileSync(png, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

      const files = await precompress(root);

      expect(files).toEqual([js, font, woff, woff2, join(root, "index.html")]);
      expect(Buffer.from(Bun.gunzipSync(readFileSync(`${woff}.gz`))).toString()).toBe("wOFF".repeat(64));
      expect(brotliDecompressSync(readFileSync(`${woff2}.br`)).toString()).toBe("wOF2".repeat(64));
      expect(brotliDecompressSync(readFileSync(`${js}.br`)).toString()).toBe(source);
      expect(Buffer.from(Bun.gunzipSync(readFileSync(`${js}.gz`))).toString()).toBe(source);
      expect(readFileSync(`${js}.br`).length).toBeLessThan(source.length / 10);
      expect([...Bun.gunzipSync(readFileSync(`${font}.gz`))]).toEqual([0, 1, 0, 0, 7, 7, 7, 7]);
      expect(readFileSync(js).toString()).toBe(source);
      expect(existsSync(`${png}.br`)).toBe(false);
      expect(existsSync(`${js}.br.gz`)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("is idempotent: a rerun produces identical sibling bytes and no nested siblings", async () => {
    const root = mkdtempSync(join(tmpdir(), "comma-precompress-"));
    try {
      writeFileSync(join(root, "app.css"), "body{color:red}".repeat(100));
      await precompress(root);
      const br = readFileSync(join(root, "app.css.br"));
      const gz = readFileSync(join(root, "app.css.gz"));
      expect(await precompress(root)).toEqual([join(root, "app.css")]);
      expect(readFileSync(join(root, "app.css.br"))).toEqual(br);
      expect(readFileSync(join(root, "app.css.gz"))).toEqual(gz);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
