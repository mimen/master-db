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

  test("streams /events and proxies /api requests to production", async () => {
    const upstream = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/events") {
          return new Response("data: one\n\ndata: two\n\n", { headers: { "content-type": "text/event-stream" } });
        }
        if (url.pathname === "/api/chats") {
          return new Response(Bun.gzipSync(new TextEncoder().encode('{"chats":[]}')), {
            headers: { "content-type": "application/json", "content-encoding": "gzip" },
          });
        }
        if (url.pathname === "/api/deploy/status") {
          return Response.json({ environment: "production", branch: null, webSha: "f".repeat(40) });
        }
        return Response.json({
          method: request.method,
          body: request.method === "POST" ? "accepted" : null,
          preview: request.headers.get("x-comma-preview"),
        });
      },
    });
    servers.push(upstream);
    const files = await fixture();
    const fetchPreview = createPreviewFetch({
      staticRoot: files.root,
      upstreamUrl: `http://127.0.0.1:${upstream.port}`,
      manifestPath: files.manifestPath,
    });

    const api = await fetchPreview(new Request("http://preview/api/send", { method: "POST", body: "accepted" }));
    expect(await api.json()).toEqual({ method: "POST", body: "accepted", preview: "production-proxy" });
    const deployStatus = await fetchPreview(new Request("http://preview/api/deploy/status"));
    expect(await deployStatus.json()).toEqual({
      environment: "preview",
      branch: "feat/test",
      webSha: "a".repeat(40),
    });
    const chats = await fetchPreview(new Request("http://preview/api/chats", { headers: { "accept-encoding": "gzip" } }));
    expect(chats.headers.get("content-encoding")).toBe("gzip");
    expect(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await chats.arrayBuffer())))).toBe('{"chats":[]}');
    const events = await fetchPreview(new Request("http://preview/events"));
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    expect(await events.text()).toBe("data: one\n\ndata: two\n\n");
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
