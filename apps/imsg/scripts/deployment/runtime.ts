import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { BranchIdentity, BranchManifest } from "./branch-core";
import { deriveBranchIdentity } from "./branch-core";

export const IMSG_ROOT = resolve(import.meta.dir, "../..");
export const REPO_ROOT = resolve(IMSG_ROOT, "../..");
export const CACHE_ROOT = resolve(IMSG_ROOT, ".cache/comma-deploy");

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export function hasFlag(name: string): boolean {
  return Bun.argv.slice(2).includes(name);
}

export function flagValue(name: string): string | null {
  const args = Bun.argv.slice(2);
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

export async function tryRun(
  command: readonly string[],
  options: { readonly cwd?: string; readonly env?: Readonly<Record<string, string>>; readonly dryRun?: boolean } = {},
): Promise<CommandResult> {
  if (options.dryRun) {
    console.log(`$ ${command.map(shellQuote).join(" ")}`);
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  const proc = Bun.spawn([...command], {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

export async function run(
  command: readonly string[],
  options: { readonly cwd?: string; readonly env?: Readonly<Record<string, string>>; readonly dryRun?: boolean } = {},
): Promise<CommandResult> {
  const result = await tryRun(command, options);
  if (result.exitCode !== 0) {
    throw new Error(`${command[0]} exited ${result.exitCode}${result.stderr ? `: ${result.stderr}` : ""}`);
  }
  return result;
}

export async function gitOutput(args: readonly string[]): Promise<string> {
  return (await run(["git", "-C", REPO_ROOT, ...args])).stdout;
}

export async function currentGitIdentity(artifact = false): Promise<BranchIdentity> {
  const [branch, worktreePath, sha] = await Promise.all([
    gitOutput(["branch", "--show-current"]),
    gitOutput(["rev-parse", "--show-toplevel"]),
    gitOutput(["rev-parse", "HEAD"]),
  ]);
  if (!branch) throw new Error("Comma development requires a named branch, not detached HEAD");
  if (branch === "main" || branch === "master") {
    throw new Error("Comma Dev may not run from the production branch; create a task branch/worktree first");
  }
  return deriveBranchIdentity({ branch, worktreePath, sha }, artifact);
}

export async function assertCleanTree(): Promise<void> {
  const status = await gitOutput(["status", "--porcelain"]);
  if (status) {
    throw new Error("Branch deployment requires a clean tree so the manifest SHA exactly identifies every deployed file");
  }
}

export async function changedPaths(): Promise<readonly string[]> {
  const mergeBase = await gitOutput(["merge-base", "HEAD", "origin/main"]);
  const [committed, working] = await Promise.all([
    gitOutput(["diff", "--name-only", `${mergeBase}...HEAD`]),
    gitOutput(["status", "--porcelain", "-uall"]),
  ]);
  const paths = new Set(committed ? committed.split("\n").filter(Boolean) : []);
  for (const line of working.split("\n").filter(Boolean)) {
    const statusPath = line.slice(3);
    const path = statusPath.includes(" -> ") ? statusPath.split(" -> ").at(-1) ?? statusPath : statusPath;
    paths.add(path.replace(/^"|"$/g, ""));
  }
  return [...paths];
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function writeJson(path: string, value: object): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readManifest(path: string): Promise<BranchManifest> {
  return JSON.parse(await readFile(path, "utf8")) as BranchManifest;
}
