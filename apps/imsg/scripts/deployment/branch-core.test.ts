import { describe, expect, test } from "bun:test";
import {
  PREVIEW_EXPIRY_MS,
  allocatePreviewPort,
  backendModeForChanges,
  cleanupDecision,
  createBranchManifest,
  deriveBranchIdentity,
  nativeInputsChanged,
  normalizeIdentitySegment,
  parseBranchManifest,
} from "./branch-core";

const input = {
  branch: "feat/Comma Preview!",
  worktreePath: "/tmp/master-db-comma-preview",
  sha: "0123456789abcdef0123456789abcdef01234567",
};

function manifest(lastActivityAt = "2026-08-20T12:00:00.000Z") {
  const identity = deriveBranchIdentity(input, true);
  const value = createBranchManifest({
    identity,
    port: 9001,
    backendMode: "production-proxy",
    deployedAt: new Date(lastActivityAt),
    desktopRequired: false,
  });
  return value;
}

describe("branch deployment identity", () => {
  test("normalizes branch and worktree identity without production collisions", () => {
    const identity = deriveBranchIdentity(input);
    expect(identity.branchSlug).toBe("feat-comma-preview");
    expect(identity.worktreeSlug).toBe("master-db-comma-preview");
    expect(identity.appName).toBe("Comma Dev — feat-comma-preview · ba2a82");
    expect(identity.bundleId).toMatch(/^com\.milad\.comma\.dev\.b[0-9a-f]{12}\.w[0-9a-f]{8}$/);
    expect(identity.bundleId).not.toBe("com.milad.imsg.desktop");
    expect(identity.windowTitle).toContain("01234567");
  });

  test("uses stable branch identity for deployable artifacts", () => {
    const first = deriveBranchIdentity(input, true);
    const second = deriveBranchIdentity({ ...input, worktreePath: "/another/worktree" }, true);
    expect(first.bundleId).toBe(second.bundleId);
    expect(first.instanceHash).toBe(first.branchHash);
  });

  test("rejects empty normalized identity", () => {
    expect(() => normalizeIdentitySegment("---")).toThrow();
  });
});

describe("preview port allocation", () => {
  test("is deterministic and reuses the existing branch allocation", () => {
    const branchHash = "0123456789abcdef";
    const first = allocatePreviewPort(branchHash, []);
    expect(allocatePreviewPort(branchHash, [])).toBe(first);
    expect(allocatePreviewPort(branchHash, [{ port: 9699, branchHash }])).toBe(9699);
    expect(() => allocatePreviewPort(branchHash, [{ port: 8447, branchHash }])).toThrow("outside");
  });

  test("probes past collisions without allocating the same port", () => {
    const branchHash = "0123456789abcdef";
    const initial = allocatePreviewPort(branchHash, []);
    const allocated = allocatePreviewPort(branchHash, [{ port: initial, branchHash: "ffffffffffff" }]);
    expect(allocated).not.toBe(initial);
  });
});

describe("branch mode", () => {
  test("keeps client and native-only changes on the production proxy", () => {
    expect(backendModeForChanges(["apps/imsg/client/src/app.tsx", "apps/imsg/desktop/src-tauri/src/lib.rs"]))
      .toBe("production-proxy");
  });

  test("uses a scratch server for server, shared, or server dependency changes", () => {
    expect(backendModeForChanges(["apps/imsg/server/app.ts"])).toBe("scratch");
    expect(backendModeForChanges(["apps/imsg/shared/types.ts"])).toBe("scratch");
    expect(backendModeForChanges(["apps/imsg/package.json"])).toBe("scratch");
  });

  test("detects native artifact inputs separately", () => {
    expect(nativeInputsChanged(["apps/imsg/desktop/src-tauri/tauri.conf.json"])).toBe(true);
    expect(nativeInputsChanged(["apps/imsg/client/src/app.tsx"])).toBe(false);
  });
});

describe("cleanup policy", () => {
  const now = Date.parse("2026-08-21T12:00:00.000Z");

  test("skips a running app regardless of expiry or merge state", () => {
    expect(cleanupDecision({ manifest: manifest(), merged: true, remoteBranchExists: false, appRunning: true }, now))
      .toEqual({ remove: false, reason: "running" });
  });

  test("cleans merged, deleted, and seven-day inactive previews", () => {
    expect(cleanupDecision({ manifest: manifest(), merged: true, remoteBranchExists: true, appRunning: false }, now).reason)
      .toBe("merged");
    expect(cleanupDecision({ manifest: manifest(), merged: false, remoteBranchExists: false, appRunning: false }, now).reason)
      .toBe("deleted");
    const inactive = new Date(now - PREVIEW_EXPIRY_MS).toISOString();
    expect(cleanupDecision({ manifest: manifest(inactive), merged: false, remoteBranchExists: true, appRunning: false }, now).reason)
      .toBe("inactive");
  });

  test("retains recent active previews", () => {
    expect(cleanupDecision({ manifest: manifest(), merged: false, remoteBranchExists: true, appRunning: false }, now))
      .toEqual({ remove: false, reason: "active" });
  });
});

describe("manifest", () => {
  test("states production proxy and scratch isolation explicitly", () => {
    const identity = deriveBranchIdentity(input, true);
    const ui = createBranchManifest({
      identity,
      port: 9001,
      backendMode: "production-proxy",
      deployedAt: new Date("2026-08-21T00:00:00Z"),
      desktopRequired: true,
      productionUrl: "https://alternate.example:9443",
    });
    expect(ui.previewUrl).toBe("https://milads-mac-mini.taild31e9a.ts.net:9001");
    expect(ui.backend.warning).toContain("single production server");
    expect(ui.backend.upstreamUrl).toBe("https://alternate.example:9443");

    const scratch = createBranchManifest({
      identity,
      port: 9002,
      backendMode: "scratch",
      deployedAt: new Date("2026-08-21T00:00:00Z"),
      desktopRequired: false,
      scratchDbPath: "/tmp/ba2a82a6c07a/state/imsg.db",
    });
    expect(scratch.backend.scratchDbPath).toBe("/tmp/ba2a82a6c07a/state/imsg.db");
    expect(scratch.backend.warning).toContain("production imsg.db is never opened");
    expect(parseBranchManifest(JSON.stringify(scratch))).toEqual(scratch);
  });

  test("rejects destructive manifest fields from remote storage", () => {
    const unsafe = { ...manifest(), previewPort: 8447 };
    expect(() => parseBranchManifest(JSON.stringify(unsafe))).toThrow("outside the branch allocation range");
    const traversal = { ...manifest(), branchHash: "../../badpath" };
    expect(() => parseBranchManifest(JSON.stringify(traversal))).toThrow("Invalid branch hash");
    const productionBundle = {
      ...manifest(),
      desktop: { ...manifest().desktop, bundleId: "com.milad.imsg.desktop" },
    };
    expect(() => parseBranchManifest(JSON.stringify(productionBundle))).toThrow("Development bundle ID");
    const pathEscape = {
      ...manifest(),
      desktop: { ...manifest().desktop, appName: "Comma Dev — x/../../Comma" },
    };
    expect(() => parseBranchManifest(JSON.stringify(pathEscape))).toThrow("Invalid development app name");
  });
});
