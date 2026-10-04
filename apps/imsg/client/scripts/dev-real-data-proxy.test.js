const { afterEach, describe, expect, test } = require("bun:test");
const http = require("node:http");
const { createDevRealDataMiddleware, shouldProxy } = require("./dev-real-data-proxy");

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

function listen(server) {
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Missing server address"));
      resolve(address.port);
    });
  });
}

describe("development real-data proxy", () => {
  test("recognizes only retained Mini paths", () => {
    for (const path of ["/api/health", "/api/convex-token?test=1", "/api/deploy/status", "/api/desktop-release", "/api/desktop-version", "/api/desktop-release/artifact/shell.tar.gz"]) expect(shouldProxy(path)).toBe(true);
    for (const path of ["/api/chats?state=all", "/api", "/events", "/api/desktop-release/extra", "/api/desktop-release/artifact/a/b"]) expect(shouldProxy(path)).toBe(false);
    expect(shouldProxy("/apiary")).toBe(false);
    expect(shouldProxy("/_expo/static/app.js")).toBe(false);
  });

  test("proxies retained requests, query strings, and preview identity", async () => {
    const upstreamPort = await listen(http.createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          method: request.method,
          url: request.url,
          body,
          preview: request.headers["x-comma-preview"],
        }));
      });
    }));
    const middleware = createDevRealDataMiddleware(
      (_request, response) => response.end("metro"),
      `http://127.0.0.1:${upstreamPort}`,
    );
    const previewPort = await listen(http.createServer((request, response) => middleware(request, response)));

    const result = await fetch(`http://127.0.0.1:${previewPort}/api/convex-token?mode=test`);

    expect(await result.json()).toEqual({
      method: "GET",
      url: "/api/convex-token?mode=test",
      body: "",
      preview: "production-proxy",
    });
  });

  test("propagates truncated upstream responses", async () => {
    const upstreamPort = await listen(http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.flushHeaders();
      response.write("partial artifact");
      setTimeout(() => response.socket.destroy(), 10);
    }));
    const middleware = createDevRealDataMiddleware(
      (_request, response) => response.end("metro"),
      `http://127.0.0.1:${upstreamPort}`,
    );
    const previewPort = await listen(http.createServer((request, response) => middleware(request, response)));

    await expect(fetch(`http://127.0.0.1:${previewPort}/api/desktop-release/artifact/shell.tar.gz`).then((response) => response.text())).rejects.toThrow();
  });

  test("rejects feature APIs locally and leaves Metro and event paths untouched", async () => {
    let upstreamRequests = 0;
    const upstreamPort = await listen(http.createServer((_request, response) => {
      upstreamRequests++;
      response.end("upstream");
    }));
    const middleware = createDevRealDataMiddleware(
      (_request, response) => response.end("metro"),
      `http://127.0.0.1:${upstreamPort}`,
    );
    const previewPort = await listen(http.createServer((request, response) => middleware(request, response)));
    for (const path of ["/api/chats", "/api/not-real", "/api/desktop-release/extra"]) {
      const response = await fetch(`http://127.0.0.1:${previewPort}${path}`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    }
    expect((await fetch(`http://127.0.0.1:${previewPort}/api/convex-token`, { method: "POST" })).status).toBe(404);
    for (const path of ["/events", "/index.bundle"]) {
      expect(await fetch(`http://127.0.0.1:${previewPort}${path}`).then((response) => response.text())).toBe("metro");
    }
    expect(upstreamRequests).toBe(0);
  });
});
