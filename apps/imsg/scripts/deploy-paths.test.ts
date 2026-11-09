import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { expect, test } from "bun:test";

const app = join(import.meta.dir, "..");
const repo = join(app, "..", "..");
const SHIPPED = ["server", "shared", "client/src", "scripts"];
const IMPORT = /from\s+"(\.{1,2}\/[^"]+)"/g;

/** A relative import resolved to the source file it names, or null when it names none. */
function sourceOf(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  return [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find(existsSync) ?? null;
}

/** Every module under convex/ that `file` imports, and those they import in turn. Generated files change nothing the Mini runs. */
function convexModules(file: string, seen = new Set<string>()): Set<string> {
  for (const [, specifier] of readFileSync(file, "utf8").matchAll(IMPORT)) {
    const target = sourceOf(file, specifier!);
    if (!target) continue;
    const path = relative(repo, target);
    if (!path.startsWith("convex/") || path.startsWith("convex/_generated/") || seen.has(path)) continue;
    seen.add(path);
    convexModules(target, seen);
  }
  return seen;
}

test("the Mini deploys when any Convex module its code imports changes", () => {
  const shipped = SHIPPED.flatMap((dir) => readdirSync(join(app, dir), { recursive: true, encoding: "utf8" })
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !path.includes("node_modules"))
    .map((path) => join(app, dir, path)));
  const imported = new Set(shipped.flatMap((file) => [...convexModules(file)]));
  const workflow = readFileSync(join(repo, ".github/workflows/deploy-imsg.yml"), "utf8");
  const triggers = new Set([...workflow.matchAll(/^\s+- "([^"]+)"$/gm)].map((match) => match[1]!));

  expect(imported.size).toBeGreaterThan(0);
  expect([...imported].filter((path) => !triggers.has(path)).sort()).toEqual([]);
});
