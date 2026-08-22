import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { Hono } from "hono";
import {
  desktopArtifactFilename,
  readDesktopRelease,
  registerDesktopReleaseRoutes,
} from "./desktop-version";

const sourceSha = "1234567890abcdef1234567890abcdef12345678";
const validRelease = {
  sourceSha,
  sha256: "a".repeat(64),
  size: 42_000,
  builtAt: "2026-08-21T12:34:56Z",
  semver: "0.1.0",
  bundleId: "com.milad.imsg.desktop",
  artifactUrl: `https://milads-mac-mini.taild31e9a.ts.net:8447/api/desktop-release/artifact/Comma-${sourceSha}.app.zip`,
};

describe("readDesktopRelease", () => {
  const dirs: string[] = [];
  function scratch(): string {
    const dir = mkdtempSync(`${tmpdir()}/desktop-release-`);
    dirs.push(dir);
    return dir;
  }

  function writeManifest(root: string, value: object): void {
    mkdirSync(`${root}/desktop/releases`, { recursive: true });
    writeFileSync(`${root}/desktop/releases/current.json`, JSON.stringify(value));
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("reads a complete deterministic release manifest", () => {
    const root = scratch();
    writeManifest(root, validRelease);

    const release = readDesktopRelease(root);
    expect(release).toEqual(validRelease);
    expect(release && desktopArtifactFilename(release)).toBe(`Comma-${sourceSha}.app.zip`);
  });

  test("returns null when the manifest is missing or invalid JSON", () => {
    expect(readDesktopRelease(scratch())).toBeNull();

    const invalid = scratch();
    mkdirSync(`${invalid}/desktop/releases`, { recursive: true });
    writeFileSync(`${invalid}/desktop/releases/current.json`, "{");
    expect(readDesktopRelease(invalid)).toBeNull();
  });

  test("serves version compatibility, release metadata, and only the current immutable artifact", async () => {
    const root = scratch();
    writeManifest(root, validRelease);
    mkdirSync(`${root}/desktop/releases/${sourceSha}`);
    writeFileSync(`${root}/desktop/releases/${sourceSha}/Comma-${sourceSha}.app.zip`, "artifact");
    const app = new Hono();
    registerDesktopReleaseRoutes(app, root, `${root}/desktop/releases`);

    const versionResponse = await app.request("/api/desktop-version");
    expect(versionResponse.status).toBe(200);
    expect(await versionResponse.json()).toEqual({ version: sourceSha, release: validRelease });

    const releaseResponse = await app.request("/api/desktop-release");
    expect(releaseResponse.status).toBe(200);
    expect(await releaseResponse.json()).toEqual(validRelease);

    const artifactResponse = await app.request(`/api/desktop-release/artifact/Comma-${sourceSha}.app.zip`);
    expect(artifactResponse.status).toBe(200);
    expect(artifactResponse.headers.get("cache-control")).toContain("immutable");
    expect(await artifactResponse.text()).toBe("artifact");

    const priorSha = "f".repeat(40);
    mkdirSync(`${root}/desktop/releases/${priorSha}`);
    writeFileSync(`${root}/desktop/releases/${priorSha}/Comma-${priorSha}.app.zip`, "prior");
    expect(await (await app.request(`/api/desktop-release/artifact/Comma-${priorSha}.app.zip`)).text()).toBe("prior");
    expect((await app.request("/api/desktop-release/artifact/Comma-other.app.zip")).status).toBe(404);
  });

  test("returns release endpoint 404 while preserving a null version response", async () => {
    const root = scratch();
    const app = new Hono();
    registerDesktopReleaseRoutes(app, root, `${root}/desktop/releases`);

    const versionResponse = await app.request("/api/desktop-version");
    expect(await versionResponse.json()).toEqual({ version: null, release: null });
    expect((await app.request("/api/desktop-release")).status).toBe(404);
  });

  test.each([
    ["short source SHA", { ...validRelease, sourceSha: "1234567" }],
    ["invalid checksum", { ...validRelease, sha256: "xyz" }],
    ["zero size", { ...validRelease, size: 0 }],
    ["invalid build time", { ...validRelease, builtAt: "yesterday" }],
    ["non-semver version", { ...validRelease, semver: sourceSha }],
    ["invalid bundle ID", { ...validRelease, bundleId: "Comma" }],
    ["insecure artifact URL", { ...validRelease, artifactUrl: validRelease.artifactUrl.replace("https:", "http:") }],
    ["mismatched artifact name", { ...validRelease, artifactUrl: validRelease.artifactUrl.replace(sourceSha, "f".repeat(40)) }],
  ])("rejects %s", (_label, manifest) => {
    const root = scratch();
    writeManifest(root, manifest);
    expect(readDesktopRelease(root)).toBeNull();
  });
});
