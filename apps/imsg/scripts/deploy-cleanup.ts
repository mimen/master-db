import { existsSync } from "node:fs";
import { readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { cleanupDecision, parseBranchManifest, type BranchManifest } from "./deployment/branch-core";
import { flagValue, hasFlag, REPO_ROOT, run, shellQuote } from "./deployment/runtime";

const apply = hasFlag("--apply");
const explicitDryRun = hasFlag("--dry-run");
if (apply && explicitDryRun) throw new Error("Choose either --apply or --dry-run");
const dryRun = !apply;
const sshTarget = flagValue("--host") ?? Bun.env.COMMA_DEPLOY_HOST ?? "macmini";
const remoteHome = (await run(["ssh", sshTarget, "printenv", "HOME"], { dryRun: explicitDryRun })).stdout || "/Users/remote";
const remoteRoot = Bun.env.COMMA_PREVIEW_ROOT ?? `${remoteHome}/Library/Application Support/Comma/Branch Previews`;
if (!/^\/[A-Za-z0-9._ /-]+$/.test(remoteRoot)) {
  throw new Error("COMMA_PREVIEW_ROOT must be an absolute path containing only safe path characters");
}
const tailscaleBin = Bun.env.TAILSCALE_BIN ?? "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const manifests = explicitDryRun ? [] : await readRemoteManifests();
if (manifests.length > 0) await run(["git", "-C", REPO_ROOT, "fetch", "-q", "origin", "main"]);

if (manifests.length === 0) {
  console.log(explicitDryRun
    ? "Dry run command contract only: no SSH reads or mutations performed."
    : "No branch preview manifests found.");
}

for (const discoveredManifest of manifests) {
  let manifest = discoveredManifest;
  let appPath = resolve(homedir(), "Applications/Comma Dev", `${manifest.desktop.appName}.app`);
  let appPaths = await relatedAppPaths(appPath);
  const [merged, remoteBranchExists, appRunning] = await Promise.all([
    isMerged(manifest.sourceSha),
    branchExists(manifest.branch),
    anyAppRunning(appPaths),
  ]);
  const decision = cleanupDecision({ manifest, merged, remoteBranchExists, appRunning }, Date.now());
  console.log(`${decision.remove ? "REMOVE" : "KEEP"} ${manifest.branch}: ${decision.reason}`);
  if (!decision.remove) continue;

  const remoteDirectory = `${remoteRoot}/${manifest.branchHash}`;
  console.log(`  Mini preview: ${remoteDirectory}`);
  console.log(`  Tailnet endpoint: ${manifest.previewUrl}`);
  for (const path of appPaths) console.log(`  Laptop app/artifact: ${path}`);
  for (const path of localStatePaths(manifest.desktop.bundleId)) console.log(`  Laptop state: ${path}`);
  if (dryRun) continue;
  const branchLockPath = `${remoteRoot}/.branch-locks/${manifest.branchHash}`;
  if (!(await acquireCleanupLock(branchLockPath))) {
    console.log(`  Deployment lock is active; retaining branch resources: ${manifest.branch}`);
    continue;
  }
  try {
  const currentManifest = await readRemoteManifest(manifest.branchHash);
  if (!currentManifest) continue;
  manifest = currentManifest;
  appPath = resolve(homedir(), "Applications/Comma Dev", `${manifest.desktop.appName}.app`);
  appPaths = await relatedAppPaths(appPath);
  const [mergedNow, branchExistsNow, appRunningNow] = await Promise.all([
    isMerged(manifest.sourceSha),
    branchExists(manifest.branch),
    anyAppRunning(appPaths),
  ]);
  const lockedDecision = cleanupDecision({
    manifest,
    merged: mergedNow,
    remoteBranchExists: branchExistsNow,
    appRunning: appRunningNow,
  }, Date.now());
  if (!lockedDecision.remove) {
    console.log(`  State changed while waiting for lock; retaining branch: ${lockedDecision.reason}`);
    continue;
  }
  const stagedApps = await stageAppsForCleanup(appPaths);
  if (stagedApps === null) {
    console.log(`  App started during cleanup; retaining branch resources: ${appPath}`);
    continue;
  }

  const remoteScript = [
    "set -euo pipefail",
    `dir=${shellQuote(remoteDirectory)}`,
    `if [ -f "$dir/preview.pid" ]; then pid="$(<"$dir/preview.pid")"; if kill -0 "$pid" 2>/dev/null; then args="$(ps -p "$pid" -o args=)"; case "$args" in *${shellQuote(manifest.processIdentity)}*) kill "$pid"; for _ in {1..50}; do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done; if kill -0 "$pid" 2>/dev/null; then print -u2 "Preview PID $pid did not exit"; exit 1; fi ;; *) print -u2 "Skipping stale PID $pid: identity mismatch" ;; esac; fi; fi`,
    `${shellQuote(tailscaleBin)} serve --https=${manifest.previewPort} off || true`,
    'rm -rf "$dir"',
    `rmdir ${shellQuote(`${remoteRoot}/.port-locks/${manifest.previewPort}`)} 2>/dev/null || true`,
  ].join("; ");
  try {
    await run(["ssh", sshTarget, `zsh -lc ${shellQuote(remoteScript)}`]);
  } catch (error) {
    await restoreStagedApps(stagedApps);
    throw error;
  }
  await unregisterAndRemoveApps(stagedApps, manifest.desktop.bundleId);
  } finally {
    await run(["ssh", sshTarget, `rm -rf ${shellQuote(branchLockPath)}`]);
  }
}

if (dryRun && manifests.length > 0) console.log("Dry run only. Re-run with --apply to perform the enumerated cleanup.");

async function acquireCleanupLock(lockPath: string): Promise<boolean> {
  const lockRoot = `${remoteRoot}/.branch-locks`;
  const script = [
    "set -euo pipefail",
    `mkdir -p ${shellQuote(lockRoot)}`,
    `lock=${shellQuote(lockPath)}`,
    'if mkdir "$lock" 2>/dev/null; then date +%s > "$lock/created-at"; exit 0; fi',
    'created="$(stat -f %m "$lock" 2>/dev/null || echo 0)"',
    'now="$(date +%s)"',
    'if [ $((now-created)) -lt 7200 ]; then exit 1; fi',
    'rm -rf "$lock"',
    'mkdir "$lock"',
    'date +%s > "$lock/created-at"',
  ].join("; ");
  const result = Bun.spawn(["ssh", sshTarget, `zsh -lc ${shellQuote(script)}`], { stdout: "ignore", stderr: "ignore" });
  return (await result.exited) === 0;
}

async function readRemoteManifest(branchHash: string): Promise<BranchManifest | null> {
  const path = `${remoteRoot}/${branchHash}/manifest.json`;
  const script = "import pathlib, sys; path = pathlib.Path(sys.argv[1]); print(path.read_text() if path.is_file() else '')";
  const result = await run(["ssh", sshTarget, `python3 -c ${shellQuote(script)} ${shellQuote(path)}`]);
  return result.stdout ? parseBranchManifest(result.stdout) : null;
}

async function readRemoteManifests(): Promise<readonly BranchManifest[]> {
  const script = [
    "import json, pathlib, sys",
    "root = pathlib.Path(sys.argv[1]).expanduser()",
    "items = []",
    "for path in root.glob('*/manifest.json'):",
    "  try: items.append(path.read_text())",
    "  except (OSError, json.JSONDecodeError): pass",
    "print(json.dumps(items))",
  ].join("\n");
  const command = `python3 -c ${shellQuote(script)} ${shellQuote(remoteRoot)}`;
  const result = await run(["ssh", sshTarget, command]);
  const serialized = JSON.parse(result.stdout || "[]") as readonly string[];
  return serialized.map(parseBranchManifest);
}

async function isMerged(sha: string): Promise<boolean> {
  const contained = await run(["git", "-C", REPO_ROOT, "branch", "-r", "--contains", sha]);
  if (contained.stdout.split("\n").some((line) => line.trim() === "origin/main")) return true;
  const cherry = await run(["git", "-C", REPO_ROOT, "cherry", "origin/main", sha]);
  const lines = cherry.stdout.split("\n").filter(Boolean);
  return lines.length > 0 && lines.every((line) => line.startsWith("- "));
}

async function branchExists(branch: string): Promise<boolean> {
  const result = await run(["git", "-C", REPO_ROOT, "ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  return result.stdout.length > 0;
}

async function isAppRunning(appPath: string): Promise<boolean> {
  const proc = Bun.spawn(["pgrep", "-f", `${appPath}/Contents/MacOS/`], { stdout: "ignore", stderr: "ignore" });
  return (await proc.exited) === 0;
}

async function relatedAppPaths(appPath: string): Promise<readonly string[]> {
  const directory = resolve(appPath, "..");
  const name = appPath.slice(directory.length + 1);
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && (entry.name === name || entry.name.startsWith(`${name}.`)))
      .map((entry) => resolve(directory, entry.name));
  } catch {
    return [appPath];
  }
}

async function anyAppRunning(appPaths: readonly string[]): Promise<boolean> {
  const results = await Promise.all(appPaths.map(isAppRunning));
  return results.some(Boolean);
}

function localStatePaths(bundleId: string): readonly string[] {
  const library = resolve(homedir(), "Library");
  return [
    resolve(library, "WebKit", bundleId),
    resolve(library, "Caches", bundleId),
    resolve(library, "HTTPStorages", bundleId),
    resolve(library, "Saved Application State", `${bundleId}.savedState`),
    resolve(library, "Containers", bundleId),
  ];
}

interface StagedApp {
  readonly original: string;
  readonly staged: string;
}

async function stageAppsForCleanup(appPaths: readonly string[]): Promise<readonly StagedApp[] | null> {
  if (await anyAppRunning(appPaths)) return null;
  const staged: StagedApp[] = [];
  for (const original of appPaths) {
    if (!existsSync(original)) continue;
    const stagedPath = `${original}.cleanup-pending-${process.pid}`;
    await rm(stagedPath, { recursive: true, force: true });
    await rename(original, stagedPath);
    staged.push({ original, staged: stagedPath });
  }
  if (await anyAppRunning(staged.flatMap((app) => [app.original, app.staged]))) {
    await restoreStagedApps(staged);
    return null;
  }
  return staged;
}

async function restoreStagedApps(apps: readonly StagedApp[]): Promise<void> {
  for (const app of [...apps].reverse()) {
    if (existsSync(app.staged) && !existsSync(app.original)) await rename(app.staged, app.original);
  }
}

async function unregisterAndRemoveApps(apps: readonly StagedApp[], bundleId: string): Promise<void> {
  const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  for (const app of apps) {
    await tryUnregister(lsregister, app.original);
    await tryUnregister(lsregister, app.staged);
    await rm(app.staged, { recursive: true, force: true });
  }
  for (const path of localStatePaths(bundleId)) await rm(path, { recursive: true, force: true });
}

async function tryUnregister(lsregister: string, appPath: string): Promise<void> {
  const result = Bun.spawn([lsregister, "-u", appPath], { stdout: "ignore", stderr: "ignore" });
  await result.exited;
}
