import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
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
    const events = await fetchPreview(new Request("http://preview/events"));
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    expect(await events.text()).toBe("data: one\n\ndata: two\n\n");
  });
});
