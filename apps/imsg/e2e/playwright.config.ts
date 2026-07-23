import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const LIVE_APP_URL = "http://milads-mac-mini:8377";
const CACHE_ROOT = join(homedir(), "Library", "Caches", "ms-playwright");

interface CachedChromium {
  readonly executablePath: string;
  readonly revision: number;
}

function executableCandidates(cacheDirectory: string): readonly string[] {
  return [
    join(cacheDirectory, "chrome-mac", "headless_shell"),
    join(cacheDirectory, "chrome-mac-arm64", "headless_shell"),
    join(cacheDirectory, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    join(cacheDirectory, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
    join(
      cacheDirectory,
      "chrome-mac",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing",
    ),
    join(
      cacheDirectory,
      "chrome-mac-arm64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing",
    ),
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

function findCachedChromiumExecutable(): string {
  if (!existsSync(CACHE_ROOT)) {
    throw new Error(`Playwright browser cache not found at ${CACHE_ROOT}`);
  }

  const cachedChromium = readdirSync(CACHE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry): CachedChromium[] => {
      const revisionMatch = entry.name.match(/^(?:chromium|chromium_headless_shell)-(\d+)$/);
      if (!revisionMatch) return [];

      const revision = Number.parseInt(revisionMatch[1], 10);
      return executableCandidates(join(CACHE_ROOT, entry.name))
        .filter(isExecutable)
        .map((executablePath) => ({ executablePath, revision }));
    })
    .sort((left, right) => right.revision - left.revision);

  const newest = cachedChromium[0];
  if (!newest) {
    throw new Error(`No executable cached Chromium build found under ${CACHE_ROOT}`);
  }
  return newest.executablePath;
}

const configDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: configDirectory,
  testMatch: "sidebar.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  reporter: "line",
  outputDir: join(tmpdir(), "imsg-playwright-test-results"),
  use: {
    baseURL: LIVE_APP_URL,
    browserName: "chromium",
    headless: true,
    launchOptions: {
      executablePath: findCachedChromiumExecutable(),
    },
    viewport: {
      width: 1440,
      height: 900,
    },
    navigationTimeout: 15_000,
    actionTimeout: 8_000,
    serviceWorkers: "block",
    screenshot: "off",
    trace: "off",
    video: "off",
  },
});
