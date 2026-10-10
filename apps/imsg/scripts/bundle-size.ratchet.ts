/**
 * Ratchet on metric 1d: the JS a first visit downloads before the list can paint, brotli-compressed.
 * Reads a built web export (default: the fixture build at e2e/fixture/dist; override with IMSG_BUNDLE_DIR)
 * and sums every <script src> in its index.html. Lazy chunks are excluded: they load on demand.
 *
 *   bun run fixture:build && bun test ./scripts/bundle-size.ratchet.ts
 *
 * Kept out of the default `bun test` run because it needs a build. Lower CEILING_BYTES when a change
 * shrinks the bundle; never raise it to make a change pass.
 */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

/** 2026-10-10 fixture build: 504,707 bytes brotli across entry, __common and the Metro runtime, plus 3%. */
const CEILING_BYTES = 520_000;

const exportDirectory = process.env.IMSG_BUNDLE_DIR ?? join(import.meta.dir, "../e2e/fixture/dist");

export async function firstVisitScriptBytes(directory: string): Promise<{ file: string; brotli: number }[]> {
  const html = await Bun.file(join(directory, "index.html")).text();
  const sources = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((match) => match[1]!);
  if (sources.length === 0) throw new Error(`no <script src> in ${directory}/index.html`);
  return Promise.all(sources.map(async (source) => {
    const path = join(directory, source);
    const precompressed = Bun.file(`${path}.br`);
    const brotli = await precompressed.exists()
      ? precompressed.size
      : brotliCompressSync(await Bun.file(path).bytes(), { params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY } }).length;
    return { file: source, brotli };
  }));
}

test("first-visit JS stays under the brotli ceiling", async () => {
  expect(existsSync(join(exportDirectory, "index.html")), `no web export at ${exportDirectory}; run bun run fixture:build`).toBe(true);
  const scripts = await firstVisitScriptBytes(exportDirectory);
  const total = scripts.reduce((sum, script) => sum + script.brotli, 0);
  console.log(`first-visit JS ${total} bytes brotli (ceiling ${CEILING_BYTES}): ${scripts.map((s) => `${s.file.split("/").pop()} ${s.brotli}`).join(", ")}`);
  expect(total).toBeLessThanOrEqual(CEILING_BYTES);
});
