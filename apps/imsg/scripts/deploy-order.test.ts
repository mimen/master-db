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

  test("includes lint in the production gate", () => {
    expect(position("bun run typecheck:imsg")).toBeLessThan(position("(cd apps/imsg && bun run lint)"));
    expect(position("(cd apps/imsg && bun run lint)")).toBeLessThan(position("(cd apps/imsg && bun test)"));
  });

  test("clears Metro cache so the bundle embeds the requested release SHA", () => {
    expect(webBuildScript).toContain("expo export --platform web --clear");
  });
});
