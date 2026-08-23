import { mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  DEFAULT_PREVIEW_HOST,
  DEFAULT_PRODUCTION_URL,
  allocatePreviewPort,
  backendModeForChanges,
  createBranchManifest,
  desktopBuildCommands,
  nativeInputsChanged,
  previewBuildEnvironment,
  previewPortReleaseScript,
  previewPortReservationScript,
  previewWebBuildCommands,
  type OccupiedPreviewPort,
} from "./deployment/branch-core";
import { prepareDesktopConfig } from "./deployment/desktop-config";
import {
  CACHE_ROOT,
  IMSG_ROOT,
  assertCleanTree,
  changedPaths,
  currentGitIdentity,
  flagValue,
  hasFlag,
  run,
  shellQuote,
  tryRun,
  writeJson,
} from "./deployment/runtime";

const dryRun = hasFlag("--dry-run");
const forceDesktop = hasFlag("--desktop");
const skipPush = hasFlag("--skip-push");
const sshTarget = flagValue("--host") ?? Bun.env.COMMA_DEPLOY_HOST ?? "macmini";
const previewHost = Bun.env.COMMA_PREVIEW_HOST ?? DEFAULT_PREVIEW_HOST;
const remoteHome = dryRun
  ? "/Users/remote"
  : (await run(["ssh", sshTarget, "printenv", "HOME"])).stdout;
const remoteRoot = Bun.env.COMMA_PREVIEW_ROOT ?? `${remoteHome}/Library/Application Support/Comma/Branch Previews`;
if (!/^\/[A-Za-z0-9._ /-]+$/.test(remoteRoot)) {
  throw new Error("COMMA_PREVIEW_ROOT must be an absolute path containing only letters, digits, spaces, dots, underscores, slashes, and hyphens");
}
const productionUrl = Bun.env.COMMA_PRODUCTION_URL ?? DEFAULT_PRODUCTION_URL;
const tailscaleBin = Bun.env.TAILSCALE_BIN ?? "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

if (!dryRun) await assertCleanTree();
const identity = await currentGitIdentity(true);
const paths = await changedPaths();
const backendMode = backendModeForChanges(paths);
const desktopRequired = forceDesktop || nativeInputsChanged(paths);
const branchLockPath = `${remoteRoot}/.branch-locks/${identity.branchHash}`;
if (!dryRun && !(await acquireBranchLock(sshTarget, remoteRoot, branchLockPath))) {
  throw new Error(`Another deployment of ${identity.branch} is already running`);
}
let allocation: { readonly port: number; readonly reservationCreated: boolean };
try {
  allocation = dryRun
    ? { port: allocatePreviewPort(identity.branchHash, []), reservationCreated: false }
    : await reservePreviewPort(sshTarget, remoteRoot, identity.branchHash);
} catch (error) {
  if (!dryRun) await tryRun(["ssh", sshTarget, `rm -rf ${shellQuote(branchLockPath)}`]);
  throw error;
}
const port = allocation.port;
const remoteDirectory = `${remoteRoot}/${identity.branchHash}`;
const remoteIncomingDirectory = `${remoteDirectory}/.incoming-${identity.sha}`;
const scratchDbPath = `${remoteDirectory}/state/imsg.db`;
const localStage = resolve(CACHE_ROOT, `branch-${identity.branchHash}`);
const localManifest = resolve(localStage, "manifest.json");
const localDist = resolve(localStage, "dist");
const localSource = resolve(localStage, "source/apps/imsg");
const localAppPath = resolve(homedir(), "Applications/Comma Dev", `${identity.appName}.app`);
const manifest = createBranchManifest({
  identity,
  port,
  host: previewHost,
  backendMode,
  deployedAt: new Date(),
  desktopRequired,
  scratchDbPath: backendMode === "scratch" ? scratchDbPath : undefined,
  artifactPath: desktopRequired ? localAppPath : undefined,
  productionUrl,
});

console.log(manifest.backend.warning);
console.log(JSON.stringify(manifest, null, 2));

if (dryRun) {
  printDryRunContract();
  process.exit(0);
}

try {
await assertSourceSha();
if (!skipPush) {
  await run(["git", "push", "origin", `HEAD:refs/heads/${identity.branch}`], { cwd: IMSG_ROOT });
}

await rm(localStage, { recursive: true, force: true });
await mkdir(localStage, { recursive: true });
const clientRoot = resolve(IMSG_ROOT, "client");
const previewEnvironment = previewBuildEnvironment(identity);
for (const command of previewWebBuildCommands()) {
  await run(command, { cwd: clientRoot, env: previewEnvironment });
}
await assertSourceSha();
await run(["rsync", "-a", "--delete", `${resolve(clientRoot, "dist")}/`, `${localDist}/`]);
if (backendMode === "scratch") {
  await mkdir(resolve(localStage, "source"), { recursive: true });
  const archive = `git -C ${shellQuote(resolve(IMSG_ROOT, "../.."))} archive HEAD apps/imsg | tar -x -C ${shellQuote(resolve(localStage, "source"))}`;
  await run(["zsh", "-lc", archive]);
  await run(["rsync", "-a", "--delete", `${localDist}/`, `${resolve(localSource, "client/dist")}/`]);
}
await assertCleanTree();
await writeJson(localManifest, manifest);

if (desktopRequired) await buildAndInstallDesktop();
await assertSourceSha();

await run(["ssh", sshTarget, `mkdir -p ${shellQuote(remoteDirectory)} && rm -rf ${shellQuote(remoteIncomingDirectory)} && mkdir ${shellQuote(remoteIncomingDirectory)}`]);
if (backendMode === "production-proxy") {
  await run(["rsync", "-a", "--delete", `${localDist}/`, incomingSpec("dist/")]);
  await run(["rsync", "-a", resolve(IMSG_ROOT, "scripts/deployment/preview-server.ts"), incomingSpec("preview-server.ts")]);
} else {
  await run([
    "rsync", "-a", "--delete",
    "--exclude", ".env",
    "--exclude", ".cache",
    "--exclude", "/node_modules",
    "--exclude", "*.db",
    "--exclude", "*.db-*",
    `${localSource}/`, incomingSpec("source/"),
  ]);
}
await run(["rsync", "-a", localManifest, incomingSpec("manifest.json")]);
await startRemotePreview();

console.log(`Branch preview deployed: ${manifest.previewUrl}`);
console.log(`Manifest: ${manifest.previewUrl}/__comma/manifest`);
if (desktopRequired) console.log(`Comma Dev app: ${localAppPath}`);
} catch (error) {
  await tryRun(["ssh", sshTarget, `rm -rf ${shellQuote(remoteIncomingDirectory)}`]);
  if (allocation.reservationCreated) {
    await releasePreviewPortLock(sshTarget, remoteRoot, port, identity.branchHash);
  }
  throw error;
} finally {
  await tryRun(["ssh", sshTarget, `rm -rf ${shellQuote(branchLockPath)}`]);
}

function incomingSpec(relativePath: string): string {
  const path = `${remoteIncomingDirectory}/${relativePath}`.replaceAll(" ", "\\ ");
  return `${sshTarget}:${path}`;
}

async function buildAndInstallDesktop(): Promise<void> {
  if (await appIsRunning(localAppPath)) {
    throw new Error(`Refusing to replace running Comma Dev app: ${localAppPath}`);
  }
  const pendingConfigPath = resolve(IMSG_ROOT, `.cache/comma-deploy/desktop-${identity.instanceHash}/tauri.dev.conf.json`);
  const commands = desktopBuildCommands(pendingConfigPath);
  await run(commands.preflight, { cwd: resolve(IMSG_ROOT, "desktop/src-tauri") });
  await prepareDesktopConfig(identity, manifest.previewUrl, { dryRun: false });
  await run(commands.build, {
    cwd: resolve(IMSG_ROOT, "desktop"),
    env: { COMMA_SOURCE_SHA: identity.sha },
  });
  await assertSourceSha();
  await assertCleanTree();
  const builtApp = resolve(IMSG_ROOT, "desktop/src-tauri/target/release/bundle/macos", `${identity.appName}.app`);
  const stagedApp = `${localAppPath}.staged`;
  const previousApp = `${localAppPath}.previous`;
  await mkdir(resolve(homedir(), "Applications/Comma Dev"), { recursive: true });
  await rm(stagedApp, { recursive: true, force: true });
  await run(["ditto", builtApp, stagedApp]);
  if (await Bun.file(resolve(previousApp, "Contents/Info.plist")).exists()) {
    if (await appIsRunning(previousApp)) throw new Error(`Previous Comma Dev app is running: ${previousApp}`);
    await rename(previousApp, `${previousApp}.${Date.now()}`);
  }
  const hadPrevious = await Bun.file(resolve(localAppPath, "Contents/Info.plist")).exists();
  try {
    if (hadPrevious) {
      await rename(localAppPath, previousApp);
      if (await appIsRunning(localAppPath) || await appIsRunning(previousApp)) {
        await rename(previousApp, localAppPath);
        await rm(stagedApp, { recursive: true, force: true });
        throw new Error(`Comma Dev app started during build; installed app was left untouched: ${localAppPath}`);
      }
    }
    await rename(stagedApp, localAppPath);
    if (hadPrevious && await appIsRunning(previousApp)) {
      throw new Error(`Previous Comma Dev app started during replacement and was retained: ${previousApp}`);
    }
  } catch (error) {
    if (hadPrevious && await Bun.file(resolve(previousApp, "Contents/Info.plist")).exists()) {
      await rm(localAppPath, { recursive: true, force: true });
      await rename(previousApp, localAppPath);
    }
    throw error;
  }
}

async function appIsRunning(appPath: string): Promise<boolean> {
  const process = Bun.spawn(["pgrep", "-f", `${appPath}/Contents/MacOS/`], { stdout: "ignore", stderr: "ignore" });
  return (await process.exited) === 0;
}

async function startRemotePreview(): Promise<void> {
  const processIdentity = manifest.processIdentity;
  const payloadItems = backendMode === "production-proxy"
    ? ["dist", "preview-server.ts", "manifest.json"]
    : ["source", "manifest.json"];
  const previousPayload = `${remoteDirectory}/.previous-payload`;
  const swapPayload = [
    `incoming=${shellQuote(remoteIncomingDirectory)}`,
    'test -f "$incoming/manifest.json"',
    `previous=${shellQuote(previousPayload)}`,
    'rm -rf "$previous"',
    'mkdir "$previous"',
    ...payloadItems.flatMap((item) => [
      `if [ -e "$dir/${item}" ]; then mv "$dir/${item}" "$previous/${item}"; fi`,
      `mv "$incoming/${item}" "$dir/${item}"`,
    ]),
    'rmdir "$incoming"',
  ];
  const common = [
    "set -euo pipefail",
    `dir=${shellQuote(remoteDirectory)}`,
    'mkdir -p "$dir/logs" "$dir/state"',
    `if [ -f "$dir/preview.pid" ]; then old_pid="$(<"$dir/preview.pid")"; if kill -0 "$old_pid" 2>/dev/null; then args="$(ps -p "$old_pid" -o args=)"; case "$args" in *${shellQuote(processIdentity)}*) kill "$old_pid"; for _ in {1..50}; do kill -0 "$old_pid" 2>/dev/null || break; sleep 0.2; done; if kill -0 "$old_pid" 2>/dev/null; then print -u2 "Preview PID $old_pid did not exit"; exit 1; fi ;; *) print -u2 "Refusing to stop PID $old_pid: preview identity mismatch"; exit 1 ;; esac; fi; fi`,
  ];
  const launch = backendMode === "production-proxy"
    ? [
        `nohup env HOST=127.0.0.1 PORT=${port} STATIC_ROOT="$dir/dist" MANIFEST_PATH="$dir/manifest.json" UPSTREAM_URL=${shellQuote(productionUrl)} zsh -lc ${shellQuote(`exec -a ${shellQuote(processIdentity)} bun ${shellQuote(`${remoteDirectory}/preview-server.ts`)}`)} >"$dir/logs/preview.log" 2>&1 &`,
      ]
    : [
        'cd "$dir/source"',
        `export HOST=127.0.0.1 PORT=${port} DB_PATH="$dir/state/imsg.db" COMMA_BRANCH_MANIFEST_PATH="$dir/manifest.json"`,
        `test "$DB_PATH" != ${shellQuote(`${remoteHome}/Programming/Repos/master-db/apps/imsg/imsg.db`)}`,
        "bun install --frozen-lockfile",
        `nohup zsh -lc ${shellQuote(`exec -a ${shellQuote(processIdentity)} bun --env-file=${shellQuote(`${remoteHome}/Programming/Repos/master-db/apps/imsg/.env`)} server/index.ts`)} >"$dir/logs/preview.log" 2>&1 &`,
      ];
  const probe = [
    "ready=0",
    `for _ in {1..60}; do pid="$(<"$dir/preview.pid")"; if /usr/sbin/lsof -nP -a -p "$pid" -iTCP:${port} -sTCP:LISTEN >/dev/null 2>&1 && /bin/ps -p "$pid" -o args= | /usr/bin/grep -Fq ${shellQuote(processIdentity)} && /usr/bin/curl -fsS --max-time 2 http://127.0.0.1:${port}/__comma/manifest | /usr/bin/grep -q ${shellQuote(manifest.sourceSha)}; then ready=1; break; fi; kill -0 "$pid" 2>/dev/null || break; sleep 1; done`,
    'if [ "$ready" -ne 1 ]; then print -u2 "Preview failed readiness/identity probe"; /usr/bin/tail -80 "$dir/logs/preview.log" >&2; exit 1; fi',
  ];
  const script = [...common, ...swapPayload, ...launch, 'echo $! > "$dir/preview.pid"', ...probe, `${shellQuote(tailscaleBin)} serve --bg --yes --https=${port} http://127.0.0.1:${port}`].join("; ");
  await run(["ssh", sshTarget, `zsh -lc ${shellQuote(script)}`]);
}

async function assertSourceSha(): Promise<void> {
  const currentSha = (await run(["git", "-C", resolve(IMSG_ROOT, "../.."), "rev-parse", "HEAD"])).stdout;
  if (currentSha !== identity.sha) {
    throw new Error(`Branch HEAD changed during deployment: expected ${identity.sha}, found ${currentSha}`);
  }
}

function printDryRunContract(): void {
  console.log("Dry run: no push, build, SSH, Tailscale, app registration, or filesystem mutation performed.");
  console.log(`Would push: HEAD -> origin/${identity.branch}${skipPush ? " (skipped by --skip-push)" : ""}`);
  console.log(`Would build branch client: ${resolve(IMSG_ROOT, "client/dist")}`);
  console.log(`Would deploy Mini files: ${remoteDirectory}`);
  console.log(`Would launch: ${manifest.processIdentity} on loopback port ${port}`);
  console.log(`Would expose tailnet URL: ${manifest.previewUrl}`);
  if (backendMode === "scratch") console.log(`Would force scratch DB_PATH: ${scratchDbPath}`);
  if (desktopRequired) console.log(`Would build/install distinct app: ${localAppPath} (${identity.bundleId})`);
}

async function acquireBranchLock(target: string, root: string, lock: string): Promise<boolean> {
  const lockRoot = `${root}/.branch-locks`;
  const script = [
    "set -euo pipefail",
    `mkdir -p ${shellQuote(lockRoot)}`,
    `lock=${shellQuote(lock)}`,
    'if mkdir "$lock" 2>/dev/null; then date +%s > "$lock/created-at"; exit 0; fi',
    'created="$(stat -f %m "$lock" 2>/dev/null || echo 0)"',
    'now="$(date +%s)"',
    'if [ $((now-created)) -lt 7200 ]; then exit 1; fi',
    'rm -rf "$lock"',
    'mkdir "$lock"',
    'date +%s > "$lock/created-at"',
  ].join("; ");
  return (await tryRun(["ssh", target, `zsh -lc ${shellQuote(script)}`])).exitCode === 0;
}

async function reservePreviewPort(
  target: string,
  root: string,
  branchHash: string,
): Promise<{ readonly port: number; readonly reservationCreated: boolean }> {
  const occupied = [...await readOccupiedPorts(target, root)];
  const existing = occupied.find((entry) => entry.branchHash === branchHash);
  if (existing) return { port: allocatePreviewPort(branchHash, occupied), reservationCreated: false };

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const port = allocatePreviewPort(branchHash, occupied);
    const reservation = await reservePortLock(target, root, port, branchHash);
    if (reservation) return { port, reservationCreated: true };
    occupied.push({ port, branchHash: `collision-${attempt}` });
  }
  throw new Error("Could not atomically reserve a branch preview port after 32 attempts");
}

async function reservePortLock(
  target: string,
  root: string,
  port: number,
  branchHash: string,
): Promise<boolean> {
  const script = previewPortReservationScript();
  const result = await tryRun([
    "ssh",
    target,
    `python3 -c ${shellQuote(script)} ${shellQuote(root)} ${port} ${shellQuote(branchHash)} 7200`,
  ]);
  return result.exitCode === 0;
}

async function releasePreviewPortLock(
  target: string,
  root: string,
  port: number,
  branchHash: string,
): Promise<void> {
  const script = previewPortReleaseScript();
  await tryRun([
    "ssh",
    target,
    `python3 -c ${shellQuote(script)} ${shellQuote(`${root}/.port-locks/${port}`)} ${shellQuote(branchHash)}`,
  ]);
}

async function readOccupiedPorts(target: string, root: string): Promise<readonly OccupiedPreviewPort[]> {
  const script = [
    "import json, pathlib, sys",
    "root = pathlib.Path(sys.argv[1]).expanduser()",
    "items = []",
    "for path in root.glob('*/manifest.json'):",
    "  try:",
    "    value = json.loads(path.read_text())",
    "    items.append({'port': int(value['previewPort']), 'branchHash': str(value['branchHash'])})",
    "  except (OSError, ValueError, KeyError, json.JSONDecodeError): pass",
    "print(json.dumps(items))",
  ].join("\n");
  const result = await run(["ssh", target, `python3 -c ${shellQuote(script)} ${shellQuote(root)}`]);
  return JSON.parse(result.stdout || "[]") as readonly OccupiedPreviewPort[];
}
