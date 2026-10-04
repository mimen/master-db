import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extractLinkPreview, isPublicPreviewHost, parsePublicPreviewUrl, type LinkPreview } from "../shared/link-preview";

export type { LinkPreview } from "../shared/link-preview";

const cache = new Map<string, { at: number; preview: LinkPreview | null }>();
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

export async function parsePreviewUrl(rawUrl: string): Promise<URL | null> {
  const url = parsePublicPreviewUrl(rawUrl);
  if (!url) return null;
  try {
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => isPublicPreviewHost(address)) ? url : null;
  } catch {
    return null;
  }
}

export async function fetchLinkPreview(url: URL): Promise<LinkPreview | null> {
  const cached = cache.get(url.href);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.preview;

  let preview: LinkPreview | null = null;
  try {
    const res = await fetch(url.href, {
      redirect: "error",
      signal: AbortSignal.timeout(6000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
        Accept: "text/html",
      },
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (res.ok && contentType.includes("text/html")) {
      const html = (await res.text()).slice(0, 300_000);
      preview = extractLinkPreview(html, url);
    }
  } catch {
    preview = null;
  }

  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url.href, { at: Date.now(), preview });
  return preview;
}
