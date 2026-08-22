import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertRenderedVisual,
  parseEmbeddedWebSha,
  parseEntryAsset,
  parseWebRelease,
  pruneVisualProofs,
  regexEscape,
} from "./verify-core";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("production deployment verification", () => {
  test("binds the real HTML entry asset to its embedded release", () => {
    const sha = "a".repeat(40);
    const html = `<html><head><meta name="comma-web-sha" content="${sha}"></head><body><script src="/_expo/static/js/web/entry-deadbeef.js"></script></body></html>`;
    expect(parseEmbeddedWebSha(html)).toBe(sha);
    expect(parseEntryAsset(html)).toBe("/_expo/static/js/web/entry-deadbeef.js");
  });

  test("rejects ambiguous release identity and blank visual renders", () => {
    expect(() => parseWebRelease({ environment: "production", branch: null, webSha: "latest" })).toThrow();
    expect(() => assertRenderedVisual("Loading", "Messages")).toThrow();
    expect(() => assertRenderedVisual("Messages Inbox Contacts Settings and conversation list", "Messages")).not.toThrow();
  });

  test("escapes canonical app paths for exact process matching", () => {
    expect(regexEscape("/Users/mimen/Applications/Comma.app/Contents/MacOS/Comma"))
      .toBe("/Users/mimen/Applications/Comma\\.app/Contents/MacOS/Comma");
  });

  test("bounds sensitive visual proof screenshots with their metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "comma-visual-proofs-"));
    roots.push(root);
    for (const digit of ["1", "2", "3"]) {
      const sha = digit.repeat(40);
      writeFileSync(join(root, `${sha}.json`), digit);
      writeFileSync(join(root, `${sha}.png`), digit);
    }
    pruneVisualProofs(root, 2);
    expect(readdirSync(root).filter((name) => name.endsWith(".json"))).toHaveLength(2);
    expect(readdirSync(root).filter((name) => name.endsWith(".png"))).toHaveLength(2);
  });
});
