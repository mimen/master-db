import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CACHE_ROOT = join(homedir(), "Library", "Caches", "ms-playwright");

interface CachedChromium {
  readonly executablePath: string;
  readonly revision: number;
}

function candidates(directory: string): readonly string[] {
  return [
    join(directory, "chrome-mac", "headless_shell"),
    join(directory, "chrome-mac-arm64", "headless_shell"),
    join(directory, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
    join(directory, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    join(directory, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
    join(directory, "chrome-mac", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
    join(directory, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
  ];
}

function executable(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function cachedChromium(): string {
  if (!existsSync(CACHE_ROOT)) throw new Error(`Playwright browser cache not found at ${CACHE_ROOT}`);
  const builds = readdirSync(CACHE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry): CachedChromium[] => {
      const match = entry.name.match(/^(?:chromium|chromium_headless_shell)-(\d+)$/);
      if (!match) return [];
      const revision = Number.parseInt(match[1], 10);
      return candidates(join(CACHE_ROOT, entry.name))
        .filter(executable)
        .map((executablePath) => ({ executablePath, revision }));
    })
    .sort((left, right) => right.revision - left.revision);
  const newest = builds[0];
  if (!newest) throw new Error(`No executable cached Chromium build found under ${CACHE_ROOT}`);
  return newest.executablePath;
}
