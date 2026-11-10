import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { cachedChromium } from "./chromium";

const PORT = Number(process.env.IMSG_FIXTURE_PORT ?? 8399);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const configDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: join(configDirectory, "fixture"),
  testMatch: "*.playwright.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: "line",
  outputDir: join(tmpdir(), "imsg-fixture-playwright-results"),
  webServer: {
    // CI builds the bundle in its own step; IMSG_FIXTURE_PREBUILT=1 serves that build instead of building again.
    command: process.env.IMSG_FIXTURE_PREBUILT === "1" ? "bun run fixture:serve" : "bun run fixture:start",
    cwd: join(configDirectory, ".."),
    url: `${BASE_URL}/api/health`,
    // Another worktree's fixture server serves that worktree's build, so a busy port fails the run rather than testing it.
    // verify-imsg's drive.sh opts in for the instance its launch.sh started.
    reuseExistingServer: process.env.IMSG_FIXTURE_REUSE === "1",
    timeout: 120_000,
    env: { ...process.env, IMSG_FIXTURE_PORT: String(PORT) },
  },
  use: {
    baseURL: BASE_URL,
    browserName: "chromium",
    headless: true,
    launchOptions: { executablePath: cachedChromium() },
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
