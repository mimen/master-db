import { createHash } from "node:crypto";
import { basename } from "node:path";

export const PRODUCTION_BUNDLE_ID = "com.milad.imsg.desktop";
export const PRODUCTION_APP_NAME = "Comma";
export const DEFAULT_PREVIEW_HOST = "milads-mac-mini.taild31e9a.ts.net";
export const DEFAULT_PRODUCTION_URL = `https://${DEFAULT_PREVIEW_HOST}:8447`;
export const PREVIEW_PORT_START = 8600;
export const PREVIEW_PORT_COUNT = 1200;
export const PREVIEW_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export type BackendMode = "production-proxy" | "scratch";

export interface GitIdentityInput {
  readonly branch: string;
  readonly worktreePath: string;
  readonly sha: string;
}

export interface BranchIdentity {
  readonly branch: string;
  readonly branchSlug: string;
  readonly branchHash: string;
  readonly worktree: string;
  readonly worktreeSlug: string;
  readonly instanceHash: string;
  readonly sha: string;
  readonly appName: string;
  readonly windowTitle: string;
  readonly bundleId: string;
  readonly processRef: string;
}

export interface BranchManifest {
  readonly schemaVersion: 1;
  readonly branch: string;
  readonly branchSlug: string;
  readonly branchHash: string;
  readonly sourceSha: string;
  readonly deployedAt: string;
  readonly lastActivityAt: string;
  readonly previewPort: number;
  readonly previewUrl: string;
  readonly processIdentity: string;
  readonly backend: {
    readonly mode: BackendMode;
    readonly upstreamUrl: string | null;
    readonly scratchDbPath: string | null;
    readonly warning: string;
  };
  readonly desktop: {
    readonly required: boolean;
    readonly appName: string;
    readonly bundleId: string;
    readonly title: string;
    readonly previewUrl: string;
    readonly iconHook: string;
    readonly artifactPath: string | null;
  };
}

export interface OccupiedPreviewPort {
  readonly port: number;
  readonly branchHash: string;
}

export interface CleanupCandidate {
  readonly manifest: BranchManifest;
  readonly merged: boolean;
  readonly remoteBranchExists: boolean;
  readonly appRunning: boolean;
}

export interface CleanupDecision {
  readonly remove: boolean;
  readonly reason: "merged" | "deleted" | "inactive" | "running" | "active";
}

export function normalizeIdentitySegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized.length === 0) throw new Error(`Cannot derive identity from ${JSON.stringify(value)}`);
  return normalized;
}

export function stableHash(value: string, length = 12): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function deriveBranchIdentity(input: GitIdentityInput, artifact = false): BranchIdentity {
  const branchSlug = normalizeIdentitySegment(input.branch);
  const worktree = basename(input.worktreePath);
  const worktreeSlug = normalizeIdentitySegment(worktree);
  const branchHash = stableHash(input.branch);
  const instanceHash = artifact
    ? branchHash
    : stableHash(`${input.branch}\0${input.worktreePath}`);
  const readableBranch = branchSlug.length <= 42 ? branchSlug : `${branchSlug.slice(0, 35)}-${branchHash.slice(0, 6)}`;
  const appName = `Comma Dev — ${readableBranch} · ${branchHash.slice(0, 6)}`;
  const bundleId = artifact
    ? `com.milad.comma.dev.b${branchHash}`
    : `com.milad.comma.dev.b${branchHash}.w${instanceHash.slice(0, 8)}`;
  if (bundleId === PRODUCTION_BUNDLE_ID || appName === PRODUCTION_APP_NAME) {
    throw new Error("Development identity must never match production");
  }
  return {
    branch: input.branch,
    branchSlug,
    branchHash,
    worktree,
    worktreeSlug,
    instanceHash,
    sha: input.sha,
    appName,
    windowTitle: `${appName} [${input.sha.slice(0, 8)}]`,
    bundleId,
    processRef: `${branchSlug}-${instanceHash.slice(0, 8)}`,
  };
}

export function allocatePreviewPort(
  branchHash: string,
  occupied: readonly OccupiedPreviewPort[],
  start = PREVIEW_PORT_START,
  count = PREVIEW_PORT_COUNT,
): number {
  if (count < 1) throw new Error("Preview port range must contain at least one port");
  const existing = occupied.find((entry) => entry.branchHash === branchHash);
  if (existing) {
    if (existing.port < start || existing.port >= start + count) {
      throw new Error(`Existing preview port ${existing.port} is outside ${start}-${start + count - 1}`);
    }
    return existing.port;
  }

  const used = new Set(occupied.map((entry) => entry.port));
  const seed = Number.parseInt(branchHash.slice(0, 8), 16);
  const strideSeed = Number.parseInt(branchHash.slice(8, 16).padEnd(8, "0"), 16);
  let stride = (strideSeed % count) | 1;
  while (greatestCommonDivisor(stride, count) !== 1) stride += 2;
  const initial = seed % count;
  for (let attempt = 0; attempt < count; attempt += 1) {
    const port = start + ((initial + attempt * stride) % count);
    if (!used.has(port)) return port;
  }
  throw new Error(`No preview ports available in ${start}-${start + count - 1}`);
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

const SERVER_AFFECTING_PREFIXES = [
  "apps/imsg/server/",
  "apps/imsg/shared/",
];
const SERVER_AFFECTING_FILES = new Set([
  "apps/imsg/package.json",
  "apps/imsg/bun.lock",
  "apps/imsg/tsconfig.json",
  "apps/imsg/tsconfig.server.json",
]);

export function backendModeForChanges(paths: readonly string[]): BackendMode {
  return paths.some(
    (path) => SERVER_AFFECTING_FILES.has(path) || SERVER_AFFECTING_PREFIXES.some((prefix) => path.startsWith(prefix)),
  )
    ? "scratch"
    : "production-proxy";
}

export function nativeInputsChanged(paths: readonly string[]): boolean {
  return paths.some((path) => path.startsWith("apps/imsg/desktop/"));
}

export function cleanupDecision(candidate: CleanupCandidate, now: number): CleanupDecision {
  if (candidate.appRunning) return { remove: false, reason: "running" };
  if (candidate.merged) return { remove: true, reason: "merged" };
  if (!candidate.remoteBranchExists) return { remove: true, reason: "deleted" };
  const lastActivity = Date.parse(candidate.manifest.lastActivityAt);
  if (!Number.isFinite(lastActivity)) throw new Error(`Invalid lastActivityAt for ${candidate.manifest.branch}`);
  if (now - lastActivity >= PREVIEW_EXPIRY_MS) return { remove: true, reason: "inactive" };
  return { remove: false, reason: "active" };
}

export function parseBranchManifest(serialized: string): BranchManifest {
  const manifest = JSON.parse(serialized) as BranchManifest;
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported branch manifest schema");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.branchSlug)) throw new Error("Invalid branch slug");
  if (!/^[0-9a-f]{12}$/.test(manifest.branchHash)) throw new Error("Invalid branch hash");
  if (!/^[0-9a-f]{40}$/.test(manifest.sourceSha)) throw new Error("Invalid source SHA");
  if (!Number.isInteger(manifest.previewPort) || manifest.previewPort < PREVIEW_PORT_START || manifest.previewPort >= PREVIEW_PORT_START + PREVIEW_PORT_COUNT) {
    throw new Error("Preview port is outside the branch allocation range");
  }
  const previewUrl = new URL(manifest.previewUrl);
  if (previewUrl.protocol !== "https:" || Number(previewUrl.port) !== manifest.previewPort || previewUrl.pathname !== "/") {
    throw new Error("Preview URL does not match its allocated HTTPS port");
  }
  if (manifest.processIdentity !== `comma:preview@${manifest.branchSlug}-${manifest.branchHash.slice(0, 8)}`) {
    throw new Error("Preview process identity does not match the manifest branch");
  }
  if (
    !manifest.desktop.appName.startsWith("Comma Dev — ")
    || manifest.desktop.appName === PRODUCTION_APP_NAME
    || manifest.desktop.appName.includes("/")
    || manifest.desktop.appName.includes(":")
    || manifest.desktop.appName.includes("..")
    || /[\x00-\x1f]/.test(manifest.desktop.appName)
  ) {
    throw new Error("Invalid development app name");
  }
  if (manifest.desktop.bundleId !== `com.milad.comma.dev.b${manifest.branchHash}`) {
    throw new Error("Development bundle ID does not match the manifest branch");
  }
  if (manifest.desktop.previewUrl !== manifest.previewUrl) throw new Error("Desktop preview URL mismatch");
  if (!Number.isFinite(Date.parse(manifest.deployedAt)) || !Number.isFinite(Date.parse(manifest.lastActivityAt))) {
    throw new Error("Invalid branch manifest timestamp");
  }
  if (manifest.backend.mode === "production-proxy") {
    if (!manifest.backend.upstreamUrl || manifest.backend.scratchDbPath !== null) throw new Error("Invalid production-proxy backend");
  } else if (manifest.backend.mode === "scratch") {
    if (manifest.backend.upstreamUrl !== null || !manifest.backend.scratchDbPath?.includes(`/${manifest.branchHash}/state/`)) {
      throw new Error("Invalid scratch backend path");
    }
  } else {
    throw new Error("Invalid branch backend mode");
  }
  return manifest;
}

export function createBranchManifest(input: {
  readonly identity: BranchIdentity;
  readonly port: number;
  readonly host?: string;
  readonly backendMode: BackendMode;
  readonly deployedAt: Date;
  readonly desktopRequired: boolean;
  readonly scratchDbPath?: string;
  readonly artifactPath?: string;
  readonly productionUrl?: string;
}): BranchManifest {
  const host = input.host ?? DEFAULT_PREVIEW_HOST;
  const previewUrl = `https://${host}:${input.port}`;
  const scratch = input.backendMode === "scratch";
  if (scratch && !input.scratchDbPath) throw new Error("Scratch backend requires an explicit scratch database path");
  return {
    schemaVersion: 1,
    branch: input.identity.branch,
    branchSlug: input.identity.branchSlug,
    branchHash: input.identity.branchHash,
    sourceSha: input.identity.sha,
    deployedAt: input.deployedAt.toISOString(),
    lastActivityAt: input.deployedAt.toISOString(),
    previewPort: input.port,
    previewUrl,
    processIdentity: `comma:preview@${input.identity.branchSlug}-${input.identity.branchHash.slice(0, 8)}`,
    backend: {
      mode: input.backendMode,
      upstreamUrl: scratch ? null : input.productionUrl ?? DEFAULT_PRODUCTION_URL,
      scratchDbPath: scratch ? input.scratchDbPath ?? null : null,
      warning: scratch
        ? "SERVER-CHANGING PREVIEW: server behavior and overlay writes use a scratch database; production imsg.db is never opened."
        : "UI-ONLY PREVIEW: /api and /events proxy to the single production server, including live read/write behavior.",
    },
    desktop: {
      required: input.desktopRequired,
      appName: input.identity.appName,
      bundleId: input.identity.bundleId,
      title: input.identity.windowTitle,
      previewUrl,
      iconHook: "COMMA_DEV_ICON_SOURCE or generated DEV-badged icon",
      artifactPath: input.artifactPath ?? null,
    },
  };
}
