import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Palette } from "../src/constants/tokens";
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
    // Keyboard focus and pinch zoom stay available.
    expect(html).not.toContain("outline:none!important");
    expect(html).not.toContain("user-scalable=no");
  });

  test("preloads the icon and header fonts the first frame paints, and nothing else", async () => {
    const root = mkdtempSync(join(tmpdir(), "comma-post-export-"));
    roots.push(root);
    writeFileSync(join(root, "index.html"), "<html><head></head><body></body></html>");
    const icons = "assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts";
    mkdirSync(join(root, icons), { recursive: true });
    mkdirSync(join(root, "assets/assets/fonts"), { recursive: true });
    writeFileSync(join(root, icons, `Ionicons.${"a".repeat(32)}.ttf`), "");
    writeFileSync(join(root, icons, `Feather.${"b".repeat(32)}.ttf`), "");
    writeFileSync(join(root, `assets/assets/fonts/BricolageGrotesque-SemiBold.${"c".repeat(32)}.ttf`), "");

    await postExport(root, undefined);

    const html = await Bun.file(join(root, "index.html")).text();
    expect(html).toContain(`<link rel="preload" href="/${icons}/Ionicons.${"a".repeat(32)}.ttf" as="font" type="font/ttf" crossorigin/>`);
    expect(html).toContain(`<link rel="preload" href="/assets/assets/fonts/BricolageGrotesque-SemiBold.${"c".repeat(32)}.ttf" as="font" type="font/ttf" crossorigin/>`);
    expect(html).not.toContain("Feather");
  });

  test("paints a loading shell on the empty root that respects reduced motion", async () => {
    const root = mkdtempSync(join(tmpdir(), "comma-post-export-"));
    roots.push(root);
    writeFileSync(join(root, "index.html"), '<html><head></head><body><div id="root"></div></body></html>');

    await postExport(root, undefined);

    const html = await Bun.file(join(root, "index.html")).text();
    expect(html).toContain("body{margin:0}");
    expect(html).toContain(`#root:empty{background:${Palette.light.background}}`);
    expect(html).toContain(`@media (prefers-color-scheme:dark){#root:empty{background:${Palette.dark.background}}`);
    expect(html).toContain("@media (prefers-reduced-motion:reduce){#root:empty::before{animation:none;opacity:.4}}");
  });

  test("loading shell grounds match the app's light and dark backgrounds", async () => {
    expect(LOADING_SHELL_CSS).toContain(`#root:empty{background:${Palette.light.background}}`);
    expect(LOADING_SHELL_CSS).toContain(`(prefers-color-scheme:dark){#root:empty{background:${Palette.dark.background}}`);
  });
});
