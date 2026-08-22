import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

export interface PreviewServerOptions {
  readonly staticRoot: string;
  readonly upstreamUrl: string;
  readonly manifestPath: string;
}

export function createPreviewFetch(options: PreviewServerOptions): (request: Request) => Promise<Response> {
  const root = resolve(options.staticRoot);
  const recordActivity = createActivityRecorder(options.manifestPath);
  return async (request: Request): Promise<Response> => {
    await recordActivity();
    const url = new URL(request.url);
    if (url.pathname === "/__comma/manifest") {
      return new Response(Bun.file(options.manifestPath), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (url.pathname === "/events" || url.pathname.startsWith("/api/")) {
      const upstream = new URL(`${url.pathname}${url.search}`, options.upstreamUrl);
      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.set("x-comma-preview", "production-proxy");
      return fetch(upstream, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual",
        signal: request.signal,
      });
    }

    const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const candidate = resolve(root, requested);
    const withinRoot = candidate === root || candidate.startsWith(`${root}${sep}`);
    if (!withinRoot) return new Response("Not found", { status: 404 });
    const file = Bun.file(candidate);
    if (await file.exists()) {
      return new Response(file, { headers: { "cache-control": cacheControl(candidate) } });
    }
    return new Response(Bun.file(resolve(root, "index.html")), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  };
}

export function createActivityRecorder(
  manifestPath: string,
  now: () => number = Date.now,
  intervalMs = 60_000,
): () => Promise<void> {
  let lastRecordedAt = 0;
  return async (): Promise<void> => {
    const timestamp = now();
    if (timestamp - lastRecordedAt < intervalMs) return;
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { lastActivityAt?: string };
      manifest.lastActivityAt = new Date(timestamp).toISOString();
      const temporary = `${manifestPath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
      await rename(temporary, manifestPath);
      lastRecordedAt = timestamp;
    } catch (error) {
      console.error(`Could not record branch preview activity: ${String(error)}`);
    }
  };
}

function cacheControl(path: string): string {
  return path.includes(`${sep}_expo${sep}static${sep}`)
    ? "public, max-age=31536000, immutable"
    : "no-store";
}

if (import.meta.main) {
  const port = Number(Bun.env.PORT);
  const hostname = Bun.env.HOST ?? "127.0.0.1";
  const staticRoot = Bun.env.STATIC_ROOT;
  const upstreamUrl = Bun.env.UPSTREAM_URL;
  const manifestPath = Bun.env.MANIFEST_PATH;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be a valid TCP port");
  if (!staticRoot) throw new Error("STATIC_ROOT is required");
  if (!upstreamUrl) throw new Error("UPSTREAM_URL is required");
  if (!manifestPath) throw new Error("MANIFEST_PATH is required");
  if (!["127.0.0.1", "::1", "localhost"].includes(hostname)) {
    throw new Error("Branch previews must bind to loopback; Tailscale Serve owns tailnet exposure");
  }
  console.log(`Comma UI preview proxy on ${hostname}:${port} -> ${upstreamUrl}`);
  Bun.serve({
    hostname,
    port,
    idleTimeout: 120,
    fetch: createPreviewFetch({ staticRoot, upstreamUrl, manifestPath }),
  });
}
