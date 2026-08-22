import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { postExport } from "./post-export";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("postExport", () => {
  test("writes release identity into a caller-selected completed export", async () => {
    const root = mkdtempSync(join(tmpdir(), "comma-post-export-"));
    roots.push(root);
    writeFileSync(
      join(root, "index.html"),
      '<html><head><meta name="viewport" content="width=device-width"><title>Expo</title></head><body></body></html>',
    );

    await postExport(root, "a".repeat(40));

    const html = await Bun.file(join(root, "index.html")).text();
    expect(html).toContain('<meta name="comma-web-sha" content="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/>');
    expect(html).toContain("manifest.webmanifest");
    expect(html).toContain("<title>Comma</title>");
  });
});
