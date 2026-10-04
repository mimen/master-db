import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { precompress } from "../precompress";
import { createPreviewFetch } from "./preview-server";

const servers: Bun.Server<undefined>[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture(): Promise<{ root: string; manifestPath: string }> {
  const root = await mkdtemp(resolve(tmpdir(), "comma-preview-"));
  directories.push(root);
  await writeFile(resolve(root, "index.html"), "<main>branch client</main>");
  await writeFile(resolve(root, "asset.js"), "branch-asset");
  const manifestPath = resolve(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({ branch: "feat/test", sourceSha: "a".repeat(40) }));
  return { root, manifestPath };
}

describe("UI-only preview server", () => {
  test("serves branch static files and SPA fallback", async () => {
    const files = await fixture();
    const fetchPreview = createPreviewFetch({
      staticRoot: files.root,
      upstreamUrl: "http://127.0.0.1:1",
      manifestPath: files.manifestPath,
    });
    expect(await (await fetchPreview(new Request("http://preview/asset.js"))).text()).toBe("branch-asset");
    expect(await (await fetchPreview(new Request("http://preview/some/client/route"))).text())
      .toContain("branch client");
    expect((await fetchPreview(new Request("http://preview/../outside"))).status).toBe(200);
    expect(await (await fetchPreview(new Request("http://preview/__comma/manifest"))).json())
      .toMatchObject({ branch: "feat/test", lastActivityAt: expect.any(String) });
  });

  test("proxies only session, release and health routes and preserves the API boundary", async () => {
    const requests: string[] = [];
    const upstream = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(url.pathname);
        if (url.pathname === "/api/desktop-release/artifact/shell.tar.gz") {
          return new Response(Bun.gzipSync(new TextEncoder().encode("shell bytes")), {
            headers: { "content-type": "application/octet-stream", "content-encoding": "gzip" },
          });
        }
        return Response.json({ path: url.pathname, query: url.search, preview: request.headers.get("x-comma-preview") });
      },
    });
    servers.push(upstream);
    const files = await fixture();
    const fetchPreview = createPreviewFetch({ staticRoot: files.root, upstreamUrl: `http://127.0.0.1:${upstream.port}`, manifestPath: files.manifestPath });
    for (const path of ["/api/health", "/api/convex-token", "/api/desktop-release", "/api/desktop-version"]) {
      expect(await (await fetchPreview(new Request(`http://preview${path}?test=1`))).json())
        .toEqual({ path, query: "?test=1", preview: "production-proxy" });
    }
    const deployStatus = await fetchPreview(new Request("http://preview/api/deploy/status"));
    expect(await deployStatus.json()).toEqual({ environment: "preview", branch: "feat/test", webSha: "a".repeat(40) });
    const artifact = await fetchPreview(new Request("http://preview/api/desktop-release/artifact/shell.tar.gz"));
    expect(artifact.headers.get("content-encoding")).toBe("gzip");
    expect(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await artifact.arrayBuffer())))).toBe("shell bytes");
    const before = requests.length;
    for (const path of ["/api/chats", "/api/not-real", "/api/desktop-release/extra", "/api/desktop-release/artifact/a/b"]) {
      const response = await fetchPreview(new Request(`http://preview${path}`));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    }
    expect((await fetchPreview(new Request("http://preview/api/convex-token", { method: "POST" }))).status).toBe(404);
    expect(await (await fetchPreview(new Request("http://preview/events"))).text()).toContain("branch client");
    expect(requests.length).toBe(before);
  });

  test("serves precompressed siblings by Accept-Encoding with production cache headers", async () => {
    const files = await fixture();
    const source = "console.log('branch');\n".repeat(200);
    await mkdir(resolve(files.root, "_expo/static/js/web"), { recursive: true });
    await writeFile(resolve(files.root, "_expo/static/js/web/entry-abc.js"), source);
    await precompress(files.root);
    const fetchPreview = createPreviewFetch({
      staticRoot: files.root,
      upstreamUrl: "http://127.0.0.1:1",
      manifestPath: files.manifestPath,
    });
    const get = (path: string, encoding: string) =>
      fetchPreview(new Request(`http://preview${path}`, { headers: { "accept-encoding": encoding } }));

    const br = await get("/_expo/static/js/web/entry-abc.js", "gzip, br");
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(br.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(br.headers.get("vary")).toBe("Accept-Encoding");
    expect(Buffer.from(await br.arrayBuffer()))
      .toEqual(await Bun.file(resolve(files.root, "_expo/static/js/web/entry-abc.js.br")).bytes().then(Buffer.from));

    const gzip = await get("/_expo/static/js/web/entry-abc.js", "gzip");
    expect(gzip.headers.get("content-encoding")).toBe("gzip");
    expect(Buffer.from(Bun.gunzipSync(new Uint8Array(await gzip.arrayBuffer()))).toString()).toBe(source);

    const identity = await get("/_expo/static/js/web/entry-abc.js", "identity");
    expect(identity.headers.get("content-encoding")).toBeNull();
    expect(await identity.text()).toBe(source);

    const route = await get("/some/client/route", "br");
    expect(route.headers.get("content-encoding")).toBe("br");
    expect(route.headers.get("cache-control")).toBe("no-store");
  });
});
