import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { MiddlewareHandler } from "hono";
import { serveStatic } from "hono/serve-static";
import { getMimeType } from "hono/utils/mime";
import { parseAccept } from "hono/utils/accept";
import { staticCacheControl } from "./static-cache";

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
