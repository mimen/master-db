import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const installer = join(import.meta.dir, "install-mini-launchagents.sh");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Mini LaunchAgent installation", () => {
  test("renders stable server and Expo identities for the selected checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "comma-launchagents-"));
    roots.push(root);
    const home = join(root, "home");
    const repo = join(home, "Programming/Repos/master-db");
    const install = join(root, "LaunchAgents");
    mkdirSync(join(repo, "apps/imsg"), { recursive: true });
    mkdirSync(install, { recursive: true });
    writeFileSync(join(install, "com.milad.imsg.plist"), "prior server plist");
    writeFileSync(join(install, "com.milad.imsg-expo.plist"), "prior expo plist");

    const result = Bun.spawnSync({
      cmd: ["/bin/bash", installer, "--repo", repo, "--home", home, "--install-dir", install, "--no-load"],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);

    const server = readFileSync(join(install, "com.milad.imsg.plist"), "utf8");
    const expo = readFileSync(join(install, "com.milad.imsg-expo.plist"), "utf8");
    expect(server).toContain("exec -a comma:server");
    expect(server).toContain(`${repo}/apps/imsg`);
    expect(expo).toContain("exec -a comma:expo");
    expect(expo).toContain("node_modules/expo/bin/cli start --port 8081");
    expect(server).not.toContain("__REPO_DIR__");
    expect(expo).not.toContain("__HOME__");
    const backup = join(home, "Library/Application Support/imsg-deploy/launchagents");
    expect(readFileSync(join(backup, "com.milad.imsg.previous.plist"), "utf8")).toBe("prior server plist");
    expect(readFileSync(join(backup, "com.milad.imsg-expo.previous.plist"), "utf8")).toBe("prior expo plist");
  });

  test("rejects a worktree as the production service checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "comma-launchagents-worktree-"));
    roots.push(root);
    const home = join(root, "home");
    const worktree = join(root, "worktree");
    mkdirSync(join(worktree, "apps/imsg"), { recursive: true });
    const result = Bun.spawnSync({
      cmd: ["/bin/bash", installer, "--repo", worktree, "--home", home, "--install-dir", join(root, "LaunchAgents"), "--no-load"],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("require canonical repo");
  });
});
