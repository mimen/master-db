import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

import {
  assertRenderedVisual,
  findCachedChromiumExecutable,
  parseEmbeddedWebSha,
  parseEntryAsset,
  parseWebRelease,
  pruneVisualProofs,
  regexEscape,
} from "./deployment/verify-core";

const BASE_URL = process.env.IMSG_TAILNET_URL ?? "https://milads-mac-mini.taild31e9a.ts.net:8447";
const APP = "/Users/mimen/Applications/Comma.app";
const EXPECTED_BUNDLE_ID = "com.milad.imsg.desktop";
const EXPECTED_VISUAL_TEXT = process.env.COMMA_VERIFY_EXPECT_TEXT ?? "Needs reply";
const STATE_DIR = process.env.IMSG_DEPLOY_STATE_DIR
  ?? join(homedir(), "Library/Application Support/imsg-deploy");
const CACHE_ROOT = join(homedir(), "Library/Caches/ms-playwright");

interface ShellReleaseIdentity {
  readonly sourceSha: string;
  readonly bundleId: string;
}

interface VisualProof {
  readonly webSha: string;
  readonly entryAsset: string;
  readonly screenshotSha256: string;
  readonly expectedText: string;
  readonly capturedAt: string;
}

function fail(message: string): never {
  throw new Error(`deploy verify: ${message}`);
}

async function checkedFetch(path: string): Promise<Response> {
  const response = await fetch(new URL(path, BASE_URL), { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) fail(`${path} returned HTTP ${response.status}`);
  return response;
}

function plistField(path: string, key: string): string {
  const result = Bun.spawnSync({
    cmd: ["plutil", "-extract", key, "raw", "-o", "-", join(path, "Contents/Info.plist")],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) fail(`installed app is missing ${key}`);
  return result.stdout.toString().trim();
}

function installedProcessCount(binary: string): number {
  const result = Bun.spawnSync({
    cmd: ["/usr/bin/pgrep", "-f", `^${regexEscape(binary)}( |$)`],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode === 1) return 0;
  if (result.exitCode !== 0) fail("could not inspect installed Comma processes");
  return result.stdout.toString().trim().split(/\s+/).filter(Boolean).length;
}

function parseShellRelease(value: object): ShellReleaseIdentity {
  const candidate = value as Partial<ShellReleaseIdentity>;
  if (!candidate.sourceSha?.match(/^[0-9a-f]{40}$/) || candidate.bundleId !== EXPECTED_BUNDLE_ID) {
    fail("published shell release identity is invalid");
  }
  return candidate as ShellReleaseIdentity;
}

function readProof(path: string): VisualProof | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as VisualProof;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const appExecutable = plistField(APP, "CFBundleExecutable");
  const appBinary = join(APP, "Contents/MacOS", appExecutable);
  const installedSha = plistField(APP, "CommaSourceSHA");
  const installedBundleId = plistField(APP, "CFBundleIdentifier");
  if (!installedSha.match(/^[0-9a-f]{40}$/) || installedBundleId !== EXPECTED_BUNDLE_ID) {
    fail("installed shell release identity is invalid");
  }
  const processCount = installedProcessCount(appBinary);
  if (processCount !== 1) fail(`expected exactly one canonical installed Comma process, found ${processCount}`);

  const [rootResponse, webResponse, shellResponse] = await Promise.all([
    checkedFetch("/"),
    checkedFetch("/api/deploy/status"),
    checkedFetch("/api/desktop-release"),
  ]);
  const html = await rootResponse.text();
  const entryAsset = parseEntryAsset(html);
  const embeddedSha = parseEmbeddedWebSha(html);
  const webRelease = parseWebRelease(JSON.parse(await webResponse.text()) as object);
  const shellRelease = parseShellRelease(JSON.parse(await shellResponse.text()) as object);
  if (embeddedSha !== webRelease.webSha) fail("HTML release SHA does not match /api/deploy/status");

  const entryResponse = await checkedFetch(entryAsset);
  const cacheControl = entryResponse.headers.get("cache-control") ?? "";
  if (!cacheControl.includes("immutable")) fail("entry asset is not served with immutable caching");
  const entryBytes = await entryResponse.text();
  if (!entryBytes.includes(webRelease.webSha)) fail("entry asset does not embed the deployed web SHA");

  const browser = await chromium.launch({
    headless: true,
    executablePath: findCachedChromiumExecutable(CACHE_ROOT),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await page.goto(new URL("/", BASE_URL).toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
  const root = page.locator("#root");
  await root.waitFor({ state: "visible", timeout: 15_000 });
  await page.getByText(EXPECTED_VISUAL_TEXT, { exact: false }).first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
  const renderedText = await root.innerText();
  assertRenderedVisual(renderedText, EXPECTED_VISUAL_TEXT);

  const proofDir = join(STATE_DIR, "visual-proofs");
  mkdirSync(proofDir, { recursive: true });
  const screenshotPath = join(proofDir, `${webRelease.webSha}.png`);
  const screenshot = await page.screenshot({ path: screenshotPath, fullPage: true });
  await browser.close();
  const screenshotSha256 = new Bun.CryptoHasher("sha256").update(screenshot).digest("hex");

  const compareSha = process.env.COMMA_VERIFY_EXPECT_VISUAL_CHANGE_FROM_SHA;
  if (compareSha) {
    const previous = readProof(join(proofDir, `${compareSha}.json`));
    if (!previous) fail(`visual baseline proof is unavailable for ${compareSha}`);
    if (previous.screenshotSha256 === screenshotSha256) {
      fail(`visual proof did not change from ${compareSha}`);
    }
  }

  const proof: VisualProof = {
    webSha: webRelease.webSha,
    entryAsset,
    screenshotSha256,
    expectedText: EXPECTED_VISUAL_TEXT,
    capturedAt: new Date().toISOString(),
  };
  const proofPath = join(proofDir, `${webRelease.webSha}.json`);
  const proofTemporary = `${proofPath}.tmp.${process.pid}`;
  writeFileSync(proofTemporary, `${JSON.stringify(proof, null, 2)}\n`);
  renameSync(proofTemporary, proofPath);
  pruneVisualProofs(proofDir, Number(process.env.COMMA_VISUAL_PROOF_RETENTION ?? "5"));

  console.log(`Production URL: ${BASE_URL}/`);
  console.log(`Rendered visual proof: ${screenshotPath}`);
  console.log(`Web release: ${webRelease.webSha} via ${entryAsset}`);
  console.log(`Shell published: ${shellRelease.sourceSha}`);
  console.log(`Shell installed: ${installedSha} (${processCount} process)`);
  console.log("Verification OK");
}

if (import.meta.main) {
  await main();
}
