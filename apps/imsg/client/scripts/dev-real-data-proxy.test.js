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
  test("recognizes only API and event-stream paths", () => {
    expect(shouldProxy("/api/chats?state=all")).toBe(true);
    expect(shouldProxy("/events")).toBe(true);
    expect(shouldProxy("/apiary")).toBe(false);
    expect(shouldProxy("/_expo/static/app.js")).toBe(false);
  });

  test("proxies methods, bodies, query strings, and preview identity", async () => {
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

    const result = await fetch(`http://127.0.0.1:${previewPort}/api/send?mode=test`, {
      method: "POST",
      body: "hello",
    });

    expect(await result.json()).toEqual({
      method: "POST",
      url: "/api/send?mode=test",
      body: "hello",
      preview: "production-proxy",
    });
  });

  test("propagates truncated upstream responses", async () => {
    const upstreamPort = await listen(http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.flushHeaders();
      response.write("data: partial\n\n");
      setTimeout(() => response.socket.destroy(), 10);
    }));
    const middleware = createDevRealDataMiddleware(
      (_request, response) => response.end("metro"),
      `http://127.0.0.1:${upstreamPort}`,
    );
    const previewPort = await listen(http.createServer((request, response) => middleware(request, response)));

    await expect(fetch(`http://127.0.0.1:${previewPort}/events`).then((response) => response.text())).rejects.toThrow();
  });

  test("streams events and leaves Metro routes untouched", async () => {
    const upstreamPort = await listen(http.createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: one\n\n");
      response.end("data: two\n\n");
    }));
    const middleware = createDevRealDataMiddleware(
      (_request, response) => response.end("metro"),
      `http://127.0.0.1:${upstreamPort}`,
    );
    const previewPort = await listen(http.createServer((request, response) => middleware(request, response)));

    const events = await fetch(`http://127.0.0.1:${previewPort}/events`);
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    expect(await events.text()).toBe("data: one\n\ndata: two\n\n");
    expect(await fetch(`http://127.0.0.1:${previewPort}/index.bundle`).then((response) => response.text())).toBe("metro");
  });
});
