const http = require("node:http");
const https = require("node:https");

function shouldProxy(url) {
  const pathname = new URL(url ?? "/", "http://localhost").pathname;
  return pathname === "/events" || pathname === "/api" || pathname.startsWith("/api/");
}

function proxyRequest(request, response, upstreamUrl) {
  const target = new URL(request.url ?? "/", upstreamUrl);
  const transport = target.protocol === "https:" ? https : http;
  const headers = { ...request.headers, host: target.host, "x-comma-preview": "production-proxy" };
  const upstream = transport.request(target, {
    method: request.method,
    headers,
  }, (upstreamResponse) => {
    const destroyDownstream = (error) => {
      if (!response.writableEnded) response.destroy(error);
    };
    upstreamResponse.on("aborted", () => destroyDownstream(new Error("Upstream response aborted")));
    upstreamResponse.on("error", destroyDownstream);
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });

  upstream.on("error", (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: `Development proxy failed: ${error.message}` }));
  });
  request.on("aborted", () => upstream.destroy());
  response.on("close", () => {
    if (!response.writableEnded) upstream.destroy();
  });
  request.pipe(upstream);
}

function createDevRealDataMiddleware(next, upstreamUrl) {
  const parsed = new URL(upstreamUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("IMSG_DEV_UPSTREAM_URL must be an absolute HTTP(S) URL");
  }
  return (request, response, nextCallback) => {
    if (shouldProxy(request.url)) {
      proxyRequest(request, response, parsed);
      return;
    }
    next(request, response, nextCallback);
  };
}

module.exports = { createDevRealDataMiddleware, shouldProxy };
