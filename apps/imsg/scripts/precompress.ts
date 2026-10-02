/** Writes `.br` and `.gz` siblings for every compressible file in a web export. */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";

const COMPRESSIBLE = /\.(?:m?js|css|html|json|webmanifest|svg|wasm|ttf|otf|eot|woff2?)$/i;
const brotli = promisify(brotliCompress);

export async function precompress(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && COMPRESSIBLE.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  await Promise.all(files.map(async (path) => {
    const bytes = await Bun.file(path).bytes();
    const br = await brotli(bytes, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
      },
    });
    await Bun.write(`${path}.br`, br);
    await Bun.write(`${path}.gz`, Bun.gzipSync(bytes, { level: 9 }));
  }));
  return files;
}

if (import.meta.main) {
  const root = process.argv[2];
  if (!root) throw new Error("usage: bun scripts/precompress.ts <export-directory>");
  const files = await precompress(root);
  if (files.length === 0) throw new Error(`no compressible files in ${root}`);
  console.log(`Precompressed ${files.length} files (br + gz) in ${root}`);
}
