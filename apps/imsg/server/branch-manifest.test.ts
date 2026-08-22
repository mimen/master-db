import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { withBranchManifest } from "./branch-manifest";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("scratch preview branch manifest", () => {
  test("serves the explicit manifest without changing ordinary server routes", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "comma-manifest-"));
    directories.push(directory);
    const manifestPath = resolve(directory, "manifest.json");
    await writeFile(manifestPath, '{"branch":"feat/server"}');
    const fetch = withBranchManifest(() => new Response("app"), manifestPath);

    const manifest = await fetch(new Request("http://preview/__comma/manifest"));
    expect(await manifest.json()).toMatchObject({
      branch: "feat/server",
      lastActivityAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(manifest.headers.get("cache-control")).toBe("no-store");
    expect(await (await fetch(new Request("http://preview/api/health"))).text()).toBe("app");
  });

  test("is disabled in production and fails closed when configured file is missing", async () => {
    const production = withBranchManifest(() => new Response("production"), null);
    expect(await (await production(new Request("http://app/__comma/manifest"))).text()).toBe("production");

    const missing = withBranchManifest(() => new Response("app"), "/missing/comma-manifest.json");
    expect((await missing(new Request("http://preview/__comma/manifest"))).status).toBe(503);
  });
});
