import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const imsgRoot = resolve(import.meta.dir, "..");
const cleanupScript = resolve(import.meta.dir, "deploy-cleanup.ts");

describe("branch cleanup entry point", () => {
  test("offers a command-only dry run without reading or mutating remote state", () => {
    const result = Bun.spawnSync(["bun", cleanupScript, "--dry-run"], {
      cwd: imsgRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = result.stdout.toString();
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(stdout).toContain("Dry run command contract only");
    expect(stdout).toContain("$ 'ssh' 'macmini' 'printenv' 'HOME'");
  });
});
