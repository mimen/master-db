import { stat } from "node:fs/promises";
import { join } from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import type { MiddlewareHandler } from "hono";
import { serveStatic } from "hono/serve-static";
import { getMimeType } from "hono/utils/mime";
import { parseAccept } from "hono/utils/accept";
import { staticCacheControl } from "./static-cache";

const gzipAsync = promisify(gzip);
const suffixes = { br: ".br", gzip: ".gz", identity: "" };
type Encoding = keyof typeof suffixes;

function encodings(header: string | undefined, candidates: Encoding[]): Encoding[] {
  const accepts = parseAccept(header ?? "");
  const wildcard = accepts.find((item) => item.type === "*")?.q;
  // An unlisted identity stays acceptable (RFC 9110 12.5.3) but ranks below anything the client named.
  const quality = (encoding: Encoding) => accepts.find((item) => item.type.toLowerCase() === encoding)?.q
    ?? (encoding === "identity" ? (wildcard === 0 ? 0 : 0.001) : wildcard ?? 0);
  return candidates.filter((encoding) => quality(encoding) > 0)
    .sort((a, b) => quality(b) - quality(a));
}

export function precompressedStatic(root: string, spa = false): MiddlewareHandler {
  return serveStatic({
    root,
    join,
    isDir: async (path) => (await stat(path).catch(() => null))?.isDirectory(),
    rewriteRequestPath: spa ? () => "/index.html" : undefined,
    getContent: async (path, c) => {
      const original = Bun.file(path);
      if (!await original.exists()) return null;
      c.header("Content-Type", getMimeType(path) ?? "application/octet-stream");
      c.header("Cache-Control", spa ? "no-store" : staticCacheControl(c.req.path));
      c.header("Vary", "Accept-Encoding", { append: true });
      const candidates: Encoding[] = c.req.header("Range") ? ["identity"] : ["br", "gzip", "identity"];
      for (const encoding of encodings(c.req.header("Accept-Encoding"), candidates)) {
        const file = encoding === "identity" ? original : Bun.file(path + suffixes[encoding]);
        if (!await file.exists()) continue;
        if (encoding !== "identity") c.header("Content-Encoding", encoding);
        c.header("Content-Length", String(file.size));
        return c.newResponse(c.req.method === "HEAD" ? null : file.stream());
      }
      return c.newResponse(null, 406);
    },
  });
}

export const compressJson: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.req.method === "HEAD" || c.req.header("Range") || c.res.status === 206
    || c.res.headers.has("Content-Range") || c.res.headers.has("Content-Encoding")
    || !c.res.headers.get("Content-Type")?.startsWith("application/json")
    || /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(c.res.headers.get("Cache-Control") ?? "")) return;
  c.header("Vary", "Accept-Encoding", { append: true });
  if (encodings(c.req.header("Accept-Encoding"), ["gzip", "identity"])[0] !== "gzip") return;
  const bytes = await c.res.arrayBuffer();
  if (bytes.byteLength < 1024) {
    c.res = new Response(bytes, c.res);
    return;
  }
  c.res = new Response(await gzipAsync(bytes), c.res);
  c.header("Content-Encoding", "gzip");
  c.res.headers.delete("Content-Length");
  const etag = c.res.headers.get("ETag");
  if (etag && !etag.startsWith("W/")) c.header("ETag", `W/${etag}`);
};
