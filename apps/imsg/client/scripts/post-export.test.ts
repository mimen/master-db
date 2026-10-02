import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LOADING_SHELL_CSS, postExport } from "./post-export";

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

  test("paints a loading shell on the empty root that respects reduced motion", async () => {
    const root = mkdtempSync(join(tmpdir(), "comma-post-export-"));
    roots.push(root);
    writeFileSync(join(root, "index.html"), '<html><head></head><body><div id="root"></div></body></html>');

    await postExport(root, undefined);

    const html = await Bun.file(join(root, "index.html")).text();
    expect(html).toContain("body{margin:0}");
    expect(html).toContain("#root:empty{background:#ffffff}");
    expect(html).toContain("@media (prefers-color-scheme:dark){#root:empty{background:#1a1a1c}");
    expect(html).toContain("@media (prefers-reduced-motion:reduce){#root:empty::before{animation:none;opacity:.4}}");
  });

  test("loading shell grounds match the app's light and dark backgrounds", async () => {
    const theme = await Bun.file(new URL("../src/constants/theme.ts", import.meta.url)).text();
    const backgrounds = [...theme.matchAll(/^    background: '(#[0-9a-f]{6})'/gm)].map((match) => match[1]);
    expect(backgrounds).toEqual(["#ffffff", "#1a1a1c"]);
    expect(LOADING_SHELL_CSS).toContain(`#root:empty{background:${backgrounds[0]}}`);
    expect(LOADING_SHELL_CSS).toContain(`(prefers-color-scheme:dark){#root:empty{background:${backgrounds[1]}}`);
  });
});
