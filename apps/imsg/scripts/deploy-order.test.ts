import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const deploy = readFileSync(join(import.meta.dir, "deploy.sh"), "utf8");
const webBuildScript = readFileSync(join(import.meta.dir, "build-web-release.sh"), "utf8");

function position(fragment: string, from = 0): number {
  const index = deploy.indexOf(fragment, from);
  expect(index, `missing deploy fragment: ${fragment}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe("production deployment publication order", () => {
  test("completes required builds before web activation", () => {
    const webBuild = position("build-web-release.sh");
    const shellBuild = position("desktop-build-release.sh --build", webBuild);
    const activation = position("web-activate.py activate", shellBuild);
    expect(webBuild).toBeLessThan(shellBuild);
    expect(shellBuild).toBeLessThan(activation);
  });

  test("publishes both release pointers only after restart and health checks", () => {
    const health = position("== Health checks ==");
    const servedBytes = position("verify-served-web.ts", health);
    const publishing = position("== Publishing verified release identity ==", servedBytes);
    expect(health).toBeLessThan(servedBytes);
    expect(servedBytes).toBeLessThan(position('>"${WEB_RELEASE_MANIFEST}.tmp.$$"', publishing));
    expect(servedBytes).toBeLessThan(position("desktop-build-release.sh --publish-current", publishing));
  });

  test("removes a first shell pointer when post-publication verification fails", () => {
    expect(deploy).toContain("SHELL_POINTER_EXISTED=0");
    expect(deploy).toContain('elif [ "$SHELL_POINTER_EXISTED" -eq 0 ]; then');
    expect(deploy).toContain('rm -f "$REPO_DIR/apps/imsg/desktop/releases/current.json"');
  });

  test("restarts the agent runner and fails the deploy when its identity is not running", () => {
    const restart = position('launchctl kickstart -k "gui/$(id -u)/com.milad.imsg-agent"');
    const health = position("== Health checks ==", restart);
    expect(position("production health check failed: comma:agent is not running", health)).toBeLessThan(position("== Publishing verified release identity =="));
  });

  test("includes lint in the production gate", () => {
    expect(position("bun run typecheck:imsg")).toBeLessThan(position("(cd apps/imsg && bun run lint)"));
    expect(position("(cd apps/imsg && bun run lint)")).toBeLessThan(position("(cd apps/imsg && bun test)"));
  });

  test("clears Metro cache so the bundle embeds the requested release SHA", () => {
    expect(webBuildScript).toContain("expo export --platform web --clear");
  });
});
