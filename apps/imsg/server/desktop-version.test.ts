import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { readDesktopVersion } from "./desktop-version";

describe("readDesktopVersion", () => {
  const dirs: string[] = [];
  function scratch(): string {
    const dir = mkdtempSync(`${tmpdir()}/desktop-version-`);
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("reads a trimmed version from desktop/VERSION", () => {
    const root = scratch();
    mkdirSync(`${root}/desktop`);
    writeFileSync(`${root}/desktop/VERSION`, "9ce55db\n");
    expect(readDesktopVersion(root)).toBe("9ce55db");
  });

  test("returns null when the marker is missing", () => {
    const root = scratch();
    writeFileSync(`${root}/other.txt`, "x");
    expect(readDesktopVersion(root)).toBeNull();
  });

  test("returns null when apps/imsg itself is missing", () => {
    expect(readDesktopVersion("/nonexistent/path/imsg")).toBeNull();
  });

  test("returns null for an empty marker", () => {
    const root = scratch();
    mkdirSync(`${root}/desktop`);
    writeFileSync(`${root}/desktop/VERSION`, "");
    expect(readDesktopVersion(root)).toBeNull();
  });
});
