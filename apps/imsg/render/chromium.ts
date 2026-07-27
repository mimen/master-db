/**
 * Locates a headless Chromium that is already on this machine.
 *
 * Playwright is a devDependency here but its browsers are not pinned to this
 * package, so `chromium.launch()` with no executablePath fails on a machine
 * whose cache holds a different revision. Every Playwright install shares the
 * same cache root, so scanning it for the newest usable build is both more
 * reliable and faster than downloading another copy.
 */
import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CACHE_ROOT = join(homedir(), "Library", "Caches", "ms-playwright");

function executableCandidates(cacheDirectory: string): readonly string[] {
  const app = (bundle: string, binary: string): readonly string[] => [
    join(cacheDirectory, "chrome-mac", bundle, "Contents", "MacOS", binary),
    join(cacheDirectory, "chrome-mac-arm64", bundle, "Contents", "MacOS", binary),
  ];
  return [
    join(cacheDirectory, "chrome-mac", "headless_shell"),
    join(cacheDirectory, "chrome-mac-arm64", "headless_shell"),
    ...app("Chromium.app", "Chromium"),
    ...app("Google Chrome for Testing.app", "Google Chrome for Testing"),
  ];
}

function isExecutable(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Newest cached Chromium executable. Prefers full Chromium over the headless
 * shell at the same revision — the shell cannot take full-page screenshots of
 * some composited layers, and the render lane leans on screenshots entirely.
 */
export function findChromiumExecutable(): string {
  if (!existsSync(CACHE_ROOT)) {
    throw new Error(
      `Playwright browser cache not found at ${CACHE_ROOT}. Run: bunx playwright install chromium`,
    );
  }

  const builds = readdirSync(CACHE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const match = entry.name.match(/^(chromium|chromium_headless_shell)-(\d+)$/);
      if (!match) return [];
      const revision = Number.parseInt(match[2], 10);
      const full = match[1] === "chromium";
      return executableCandidates(join(CACHE_ROOT, entry.name))
        .filter(isExecutable)
        .map((executablePath) => ({ executablePath, revision, full }));
    })
    .sort((left, right) => right.revision - left.revision || Number(right.full) - Number(left.full));

  const newest = builds[0];
  if (!newest) {
    throw new Error(
      `No executable Chromium build under ${CACHE_ROOT}. Run: bunx playwright install chromium`,
    );
  }
  return newest.executablePath;
}
