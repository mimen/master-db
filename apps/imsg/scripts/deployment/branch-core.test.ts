import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  PREVIEW_EXPIRY_MS,
  allocatePreviewPort,
  backendModeForChanges,
  cleanupDecision,
  createBranchManifest,
  deriveBranchIdentity,
  desktopBuildCommands,
  nativeInputsChanged,
  previewBuildEnvironment,
  previewWebBuildCommands,
  normalizeIdentitySegment,
  parseBranchManifest,
  previewPortReleaseScript,
  previewPortReservationScript,
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
    expect(nativeInputsChanged(["apps/imsg/scripts/deployment/desktop-config.ts"])).toBe(true);
    expect(nativeInputsChanged(["apps/imsg/scripts/deploy-branch.ts"])).toBe(true);
    expect(nativeInputsChanged(["apps/imsg/scripts/desktop-activate.sh"])).toBe(true);
    expect(nativeInputsChanged(["apps/imsg/client/src/app.tsx"])).toBe(false);
  });

  test("embeds exact preview release identity in branch web builds", () => {
    const identity = deriveBranchIdentity(input, true);
    expect(previewBuildEnvironment(identity)).toEqual({
      EXPO_PUBLIC_IMSG_RELEASE_ENVIRONMENT: "preview",
      EXPO_PUBLIC_IMSG_RELEASE_BRANCH: input.branch,
      EXPO_PUBLIC_IMSG_WEB_SHA: input.sha,
    });
    expect(previewWebBuildCommands()).toEqual([
      ["bun", "scripts/validate-public-env.ts"],
      ["bunx", "expo", "export", "--platform", "web", "--clear"],
      ["bun", "scripts/post-export.ts"],
    ]);
  });

  test("checks Cargo.lock before a locked native build", () => {
    expect(desktopBuildCommands("/tmp/tauri.dev.conf.json")).toEqual({
      preflight: ["cargo", "metadata", "--locked", "--format-version", "1", "--no-deps"],
      build: ["bunx", "tauri", "build", "--config", "/tmp/tauri.dev.conf.json", "--", "--locked"],
    });
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

  test("retains candidates whose source SHA cannot be resolved", () => {
    expect(cleanupDecision({ manifest: manifest(), merged: null, remoteBranchExists: false, appRunning: false }, now))
      .toEqual({ remove: false, reason: "source-unresolved" });
  });
});

describe("preview port lock cleanup", () => {
  function reserve(root: string, port: number, branchHash: string, staleAfterSeconds: number): number {
    return Bun.spawnSync([
      "python3",
      "-c",
      previewPortReservationScript(),
      root,
      String(port),
      branchHash,
      String(staleAfterSeconds),
    ]).exitCode;
  }

  function release(root: string, port: number, branchHash: string): number {
    return Bun.spawnSync([
      "python3",
      "-c",
      previewPortReleaseScript(),
      resolve(root, `.port-locks/${port}`),
      branchHash,
    ]).exitCode;
  }

  test("reclaims a stale orphan and records the new owner", () => {
    const root = mkdtempSync(resolve(tmpdir(), "comma-port-lock-"));
    try {
      expect(reserve(root, 9001, "aaaaaaaaaaaa", 3600)).toBe(0);
      expect(reserve(root, 9001, "bbbbbbbbbbbb", 3600)).toBe(1);
      writeFileSync(resolve(root, ".port-locks/9001/created-at"), "0\n");
      expect(reserve(root, 9001, "bbbbbbbbbbbb", 1)).toBe(0);
      expect(readFileSync(resolve(root, ".port-locks/9001/branch-hash"), "utf8").trim())
        .toBe("bbbbbbbbbbbb");
      expect(release(root, 9001, "aaaaaaaaaaaa")).toBe(2);
      expect(existsSync(resolve(root, ".port-locks/9001"))).toBe(true);
      expect(release(root, 9001, "bbbbbbbbbbbb")).toBe(0);
      expect(existsSync(resolve(root, ".port-locks/9001"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("allows only one concurrent stale-lock reclaimer", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "comma-port-lock-"));
    try {
      expect(reserve(root, 9003, "eeeeeeeeeeee", 3600)).toBe(0);
      writeFileSync(resolve(root, ".port-locks/9003/created-at"), "0\n");
      const launch = (branchHash: string) => Bun.spawn([
        "python3",
        "-c",
        previewPortReservationScript(),
        root,
        "9003",
        branchHash,
        "1",
      ], { stdout: "ignore", stderr: "ignore" });
      const first = launch("111111111111");
      const second = launch("222222222222");
      const exits = await Promise.all([first.exited, second.exited]);
      expect(exits.sort()).toEqual([0, 1]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("retains locks claimed by a manifest or active branch deployment", () => {
    const root = mkdtempSync(resolve(tmpdir(), "comma-port-lock-"));
    try {
      expect(reserve(root, 9002, "cccccccccccc", 3600)).toBe(0);
      writeFileSync(resolve(root, ".port-locks/9002/created-at"), "0\n");
      mkdirSync(resolve(root, "preview"));
      writeFileSync(resolve(root, "preview/manifest.json"), JSON.stringify({ previewPort: 9002 }));
      expect(reserve(root, 9002, "dddddddddddd", 1)).toBe(1);

      rmSync(resolve(root, "preview"), { recursive: true });
      mkdirSync(resolve(root, ".branch-locks/cccccccccccc"), { recursive: true });
      expect(reserve(root, 9002, "dddddddddddd", 3600)).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
    const mismatchedBranch = { ...manifest(), branch: "feat/another-preview" };
    expect(() => parseBranchManifest(JSON.stringify(mismatchedBranch))).toThrow("does not match its branch name");
    const productionBundle = {
      ...manifest(),
      desktop: { ...manifest().desktop, bundleId: "com.milad.imsg.desktop" },
    };
    expect(() => parseBranchManifest(JSON.stringify(productionBundle))).toThrow("Development app identity");
    const pathEscape = {
      ...manifest(),
      desktop: { ...manifest().desktop, appName: "Comma Dev — x/../../Comma" },
    };
    expect(() => parseBranchManifest(JSON.stringify(pathEscape))).toThrow("Invalid development app name");
  });
});
