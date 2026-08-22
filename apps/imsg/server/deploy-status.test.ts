import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

import { readDeployedWebRelease, registerDeployStatusRoute } from "./deploy-status";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function manifestPath(): string {
  const root = mkdtempSync(join(tmpdir(), "imsg-deploy-status-"));
  roots.push(root);
  return join(root, "web-release.json");
}

describe("deployed web release status", () => {
  test("reads a strict production release manifest", () => {
    const path = manifestPath();
    writeFileSync(path, JSON.stringify({
      environment: "production",
      branch: null,
      webSha: "a".repeat(40),
    }));

    expect(readDeployedWebRelease(path)).toEqual({
      environment: "production",
      branch: null,
      webSha: "a".repeat(40),
    });
  });

  test("rejects missing or ambiguous release identity", () => {
    const path = manifestPath();
    expect(readDeployedWebRelease(path)).toBeNull();
    writeFileSync(path, JSON.stringify({ environment: "production", webSha: "latest" }));
    expect(readDeployedWebRelease(path)).toBeNull();
  });

  test("serves the current release and fails closed when unavailable", async () => {
    const path = manifestPath();
    const app = new Hono();
    registerDeployStatusRoute(app, path);

    expect((await app.request("/api/deploy/status")).status).toBe(404);
    writeFileSync(path, JSON.stringify({
      environment: "preview",
      branch: "feat/release-ui",
      webSha: "b".repeat(40),
    }));
    const response = await app.request("/api/deploy/status");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      environment: "preview",
      branch: "feat/release-ui",
      webSha: "b".repeat(40),
    });
  });
});
