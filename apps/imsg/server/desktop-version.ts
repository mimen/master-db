import { basename } from "node:path";
import { readFileSync } from "node:fs";
import type { Hono } from "hono";

export interface DesktopReleaseManifest {
  sourceSha: string;
  sha256: string;
  size: number;
  builtAt: string;
  semver: string;
  bundleId: string;
  artifactUrl: string;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

function isRecord(value: object | null): value is Record<string, object | string | number | null> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDesktopReleaseManifest(value: object | null): DesktopReleaseManifest | null {
  if (!isRecord(value)) return null;
  const { sourceSha, sha256, size, builtAt, semver, bundleId, artifactUrl } = value;
  if (typeof sourceSha !== "string" || !SHA_PATTERN.test(sourceSha)) return null;
  if (typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256)) return null;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) return null;
  if (typeof builtAt !== "string" || Number.isNaN(Date.parse(builtAt))) return null;
  if (typeof semver !== "string" || !SEMVER_PATTERN.test(semver)) return null;
  if (typeof bundleId !== "string" || !BUNDLE_ID_PATTERN.test(bundleId)) return null;
  if (typeof artifactUrl !== "string") return null;

  let artifact: URL;
  try {
    artifact = new URL(artifactUrl);
  } catch {
    return null;
  }
  if (artifact.protocol !== "https:" || basename(artifact.pathname) !== `Comma-${sourceSha}.app.zip`) {
    return null;
  }

  return { sourceSha, sha256, size, builtAt, semver, bundleId, artifactUrl };
}

/** Reads the current immutable Comma shell release published by deploy.sh. */
export function readDesktopRelease(root: string): DesktopReleaseManifest | null {
  try {
    const parsed = JSON.parse(readFileSync(`${root}/desktop/releases/current.json`, "utf8")) as object | null;
    return parseDesktopReleaseManifest(parsed);
  } catch {
    return null;
  }
}

/** Resolves the current artifact filename without accepting arbitrary paths from a request. */
export function desktopArtifactFilename(release: DesktopReleaseManifest): string {
  return basename(new URL(release.artifactUrl).pathname);
}

export function registerDesktopReleaseRoutes(app: Hono, desktopRoot: string, releaseRoot: string): void {
  app.get("/api/desktop-version", (c) => {
    const release = readDesktopRelease(desktopRoot);
    return c.json({ version: release?.sourceSha ?? null, release });
  });

  app.get("/api/desktop-release", (c) => {
    const release = readDesktopRelease(desktopRoot);
    return release ? c.json(release) : c.json({ error: "desktop release unavailable" }, 404);
  });

  app.get("/api/desktop-release/artifact/:filename", async (c) => {
    const filename = c.req.param("filename");
    const match = /^Comma-([0-9a-f]{40})\.app\.zip$/.exec(filename);
    if (!match) return c.json({ error: "desktop artifact unavailable" }, 404);
    const artifact = Bun.file(`${releaseRoot}/${match[1]}/${filename}`);
    if (!(await artifact.exists())) return c.json({ error: "desktop artifact unavailable" }, 404);
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    c.header("Content-Type", "application/zip");
    return c.body(artifact.stream(), 200, { "Content-Length": String(artifact.size) });
  });
}
