import { accessSync, constants, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export interface WebReleaseIdentity {
  readonly environment: "production";
  readonly branch: null;
  readonly webSha: string;
}

export function parseEntryAsset(html: string): string {
  const match = html.match(/<script[^>]+src=["']([^"']+\/_expo\/static\/js\/web\/[^"']+\.js)["']/i)
    ?? html.match(/<script[^>]+src=["']([^"']+\.js)["']/i);
  if (!match?.[1]) throw new Error("production index has no JavaScript entry asset");
  return match[1];
}

export function parseEmbeddedWebSha(html: string): string {
  const match = html.match(/<meta\s+name=["']comma-web-sha["']\s+content=["']([0-9a-f]{40})["']/i);
  if (!match?.[1]) throw new Error("production index has no embedded release SHA");
  return match[1];
}

export function parseWebRelease(value: object): WebReleaseIdentity {
  const candidate = value as Partial<WebReleaseIdentity>;
  if (candidate.environment !== "production" || candidate.branch !== null || !candidate.webSha?.match(/^[0-9a-f]{40}$/)) {
    throw new Error("production web release identity is invalid");
  }
  return candidate as WebReleaseIdentity;
}

export function assertRenderedVisual(renderedText: string, expectedText: string): void {
  const normalized = renderedText.replace(/\s+/g, " ").trim();
  if (normalized.length < 20) throw new Error("production root rendered no meaningful UI text");
  if (!normalized.includes(expectedText)) {
    throw new Error(`production root did not render visual proof text: ${expectedText}`);
  }
}

function executableCandidates(cacheDirectory: string): readonly string[] {
  return [
    join(cacheDirectory, "chrome-mac", "headless_shell"),
    join(cacheDirectory, "chrome-mac-arm64", "headless_shell"),
    join(cacheDirectory, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    join(cacheDirectory, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
    join(cacheDirectory, "chrome-mac", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
    join(cacheDirectory, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
  ];
}

export function findCachedChromiumExecutable(cacheRoot: string): string {
  if (!existsSync(cacheRoot)) throw new Error(`Playwright browser cache not found at ${cacheRoot}`);
  const candidates = readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const match = entry.name.match(/^(?:chromium|chromium_headless_shell)-(\d+)$/);
      if (!match?.[1]) return [];
      return executableCandidates(join(cacheRoot, entry.name)).flatMap((path) => {
        try {
          accessSync(path, constants.X_OK);
          return [{ path, revision: Number.parseInt(match[1]!, 10) }];
        } catch {
          return [];
        }
      });
    })
    .sort((left, right) => right.revision - left.revision);
  const newest = candidates[0];
  if (!newest) throw new Error(`No executable cached Chromium build found under ${cacheRoot}`);
  return newest.path;
}

export function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function pruneVisualProofs(directory: string, retention: number): void {
  if (!Number.isSafeInteger(retention) || retention < 1) throw new Error("visual proof retention must be positive");
  const proofs = readdirSync(directory)
    .filter((name) => /^[0-9a-f]{40}\.json$/.test(name))
    .map((name) => ({ name, modifiedAt: statSync(join(directory, name)).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  for (const proof of proofs.slice(retention)) {
    const sha = proof.name.slice(0, -".json".length);
    rmSync(join(directory, proof.name), { force: true });
    rmSync(join(directory, `${sha}.png`), { force: true });
  }
}
