import { mkdir, open, readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import {
  allocatePreviewPort,
  backendModeForChanges,
  DEFAULT_PRODUCTION_URL,
  type OccupiedPreviewPort,
} from "./deployment/branch-core";
import {
  changedPaths,
  currentGitIdentity,
  gitOutput,
  IMSG_ROOT,
  shellQuote,
  tryRun,
} from "./deployment/runtime";

export interface DevWebOptions {
  readonly data: "real";
  readonly allowServerDrift: boolean;
}

interface DevWebPortLock {
  readonly port: number;
  readonly instanceHash: string;
  readonly pid: number;
}

export interface DevWebPortLease {
  readonly port: number;
  release(): Promise<void>;
}

const DEFAULT_PORT_LOCK_ROOT = resolve(homedir(), "Library/Caches/Comma/dev-web-ports");

export function parseDevWebOptions(args: readonly string[]): DevWebOptions {
  let data: string | null = null;
  let allowServerDrift = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--allow-server-drift") {
      allowServerDrift = true;
      continue;
    }
    if (arg?.startsWith("--data=")) {
      data = arg.slice("--data=".length);
      continue;
    }
    if (arg === "--data") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--data requires a value");
      data = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown dev:web argument: ${arg}`);
  }
  if (data === null) throw new Error("Choose a data mode explicitly: bun run dev:web -- --data=real");
  if (data !== "real") throw new Error(`Unsupported data mode ${JSON.stringify(data)}; v1 supports only real`);
  return { data, allowServerDrift };
}

export function assertRealDataCompatibility(paths: readonly string[], allowServerDrift: boolean): void {
  if (backendModeForChanges(paths) === "production-proxy") return;
  if (allowServerDrift) return;
  throw new Error([
    "This branch changes server/shared code that is not deployed on the production Mini.",
    "Use the scratch branch-preview path, or intentionally accept mixed versions with:",
    "bun run dev:web -- --data=real --allow-server-drift",
  ].join("\n"));
}

export function devWebPort(instanceHash: string, occupied: readonly OccupiedPreviewPort[] = []): number {
  return allocatePreviewPort(instanceHash, occupied, 18_000, 1_000);
}

export function mainWorktreePath(porcelain: string): string | null {
  for (const block of porcelain.trim().split(/\n\n+/)) {
    const lines = block.split("\n");
    const worktree = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    const branch = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length);
    if (worktree && (branch === "refs/heads/main" || branch === "refs/heads/master")) return worktree;
  }
  return null;
}

export async function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolveAvailability) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolveAvailability(false);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      resolveAvailability(error.code === "ECONNREFUSED");
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolveAvailability(false);
    });
  });
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readPortLock(path: string): Promise<DevWebPortLock | null> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const text = await readFile(path, "utf8");
      if (!text.trim()) {
        await Bun.sleep(10);
        continue;
      }
      const lock = JSON.parse(text) as DevWebPortLock;
      return Number.isInteger(lock.port) && typeof lock.instanceHash === "string" && Number.isInteger(lock.pid)
        ? lock
        : null;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      if (error instanceof SyntaxError) {
        await Bun.sleep(10);
        continue;
      }
      throw error;
    }
  }
  return null;
}

export async function reserveDevWebPort(
  instanceHash: string,
  lockRoot: string = DEFAULT_PORT_LOCK_ROOT,
): Promise<DevWebPortLease> {
  await mkdir(lockRoot, { recursive: true });
  const occupied: OccupiedPreviewPort[] = [];
  for (const entry of await readdir(lockRoot)) {
    if (!entry.endsWith(".json")) continue;
    const path = resolve(lockRoot, entry);
    const lock = await readPortLock(path);
    if (!lock || !processAlive(lock.pid)) {
      await rm(path, { force: true });
      continue;
    }
    if (lock.instanceHash === instanceHash) {
      throw new Error(`Development server is already running at http://127.0.0.1:${lock.port}`);
    }
    occupied.push({ port: lock.port, branchHash: lock.instanceHash });
  }

  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const port = devWebPort(instanceHash, occupied);
    const lockPath = resolve(lockRoot, `${port}.json`);
    let handle;
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const existing = await readPortLock(lockPath);
        if (existing?.instanceHash === instanceHash && processAlive(existing.pid)) {
          throw new Error(`Development server is already running at http://127.0.0.1:${existing.port}`);
        }
        occupied.push({ port, branchHash: existing?.instanceHash ?? `lock-${port}` });
        continue;
      }
      throw error;
    }
    if (!(await portAvailable(port))) {
      await handle.close();
      await rm(lockPath, { force: true });
      occupied.push({ port, branchHash: `listener-${port}` });
      continue;
    }
    const lock: DevWebPortLock = { port, instanceHash, pid: process.pid };
    await handle.writeFile(`${JSON.stringify(lock)}\n`);
    await handle.sync();
    await handle.close();
    let released = false;
    return {
      port,
      async release(): Promise<void> {
        if (released) return;
        released = true;
        try {
          const current = JSON.parse(await readFile(lockPath, "utf8")) as DevWebPortLock;
          if (current.instanceHash === instanceHash && current.pid === process.pid) {
            await rm(lockPath, { force: true });
          }
        } catch {
          // Missing or replaced locks belong to cleanup on the next launch.
        }
      },
    };
  }
  throw new Error("No development web ports are available");
}

export function listenerAddresses(lsofOutput: string): readonly string[] {
  return lsofOutput.split("\n").filter((line) => line.startsWith("n")).map((line) => line.slice(1));
}

export function listenersAreLoopback(addresses: readonly string[], port: number): boolean {
  return addresses.length > 0 && addresses.every((address) => address === `127.0.0.1:${port}`);
}

async function waitForLoopbackListener(
  child: { readonly exitCode: number | null; kill(): void },
  port: number,
): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Expo exited before opening port ${port}`);
    const result = await tryRun(["/usr/sbin/lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fn"]);
    const addresses = listenerAddresses(result.stdout);
    if (addresses.length > 0) {
      if (!listenersAreLoopback(addresses, port)) {
        child.kill();
        throw new Error(`Unsafe Metro listener on ${addresses.join(", ")}; expected 127.0.0.1:${port}`);
      }
      return;
    }
    await Bun.sleep(250);
  }
  child.kill();
  throw new Error(`Timed out waiting for loopback Metro listener on port ${port}`);
}

async function requireClientEnv(clientRoot: string): Promise<void> {
  const destination = resolve(clientRoot, ".env");
  if (await Bun.file(destination).exists()) return;
  const worktrees = await gitOutput(["worktree", "list", "--porcelain"]);
  const primary = mainWorktreePath(worktrees);
  const source = primary ? resolve(primary, "apps/imsg/client/.env") : null;
  const copyCommand = source
    ? `cp ${shellQuote(source)} ${shellQuote(destination)}`
    : `cp /path/to/primary/apps/imsg/client/.env ${shellQuote(destination)}`;
  throw new Error(`Missing ${destination}\nCopy the canonical client environment into this worktree:\n${copyCommand}`);
}

export async function runDevWeb(args: readonly string[]): Promise<number> {
  const options = parseDevWebOptions(args);
  const identity = await currentGitIdentity();
  const clientRoot = resolve(IMSG_ROOT, "client");
  await requireClientEnv(clientRoot);
  const paths = await changedPaths();
  assertRealDataCompatibility(paths, options.allowServerDrift);
  const serverDrift = backendModeForChanges(paths) === "scratch";
  const lease = await reserveDevWebPort(identity.instanceHash);
  const port = lease.port;
  const url = `http://127.0.0.1:${port}`;
  const upstreamUrl = Bun.env.IMSG_DEV_UPSTREAM_URL ?? DEFAULT_PRODUCTION_URL;
  const processIdentity = `comma:web-dev@${identity.processRef}`;
  console.log("\nCOMMA UX DEVELOPMENT — LIVE DATA / LIVE WRITES");
  if (serverDrift) console.warn("SERVER DRIFT ALLOWED — browser/shared code may disagree with the production API");
  console.log(`Branch: ${identity.branch}`);
  console.log(`Browser: ${url}`);
  console.log(`API/SSE: ${upstreamUrl}\n`);

  const { PROCID: _procid, PROCID_REF: _procidRef, PROCID_OFF: _procidOff, ...baseEnv } = process.env;
  const loopbackPreload = resolve(clientRoot, "scripts/force-loopback-listen.js");
  const command = [
    `exec -a ${shellQuote(processIdentity)}`,
    `bun run --preload ${shellQuote(loopbackPreload)} --no-orphans expo start`,
    "--web",
    "--localhost",
    `--port ${port}`,
  ].join(" ");
  try {
    const child = Bun.spawn(["zsh", "-lc", command], {
      cwd: clientRoot,
      env: {
        ...baseEnv,
        IMSG_FORCE_LOOPBACK: "1",
        NODE_OPTIONS: `${baseEnv.NODE_OPTIONS ?? ""} --require=${loopbackPreload}`.trim(),
        IMSG_DEV_DATA: options.data,
        IMSG_DEV_UPSTREAM_URL: upstreamUrl,
        EXPO_PUBLIC_IMSG_RELEASE_ENVIRONMENT: "development",
        EXPO_PUBLIC_IMSG_RELEASE_BRANCH: identity.branch,
        EXPO_PUBLIC_IMSG_WEB_SHA: "",
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    try {
      await waitForLoopbackListener(child, port);
    } catch (error) {
      child.kill();
      await child.exited;
      throw error;
    }
    return await child.exited;
  } finally {
    await lease.release();
  }
}

if (import.meta.main) {
  try {
    process.exit(await runDevWeb(Bun.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
