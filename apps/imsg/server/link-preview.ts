import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const cache = new Map<string, { at: number; preview: LinkPreview | null }>();
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

function metaContent(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1]);
  }
  return null;
}

function decodeEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
}

export async function parsePreviewUrl(rawUrl: string): Promise<URL | null> {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (host === "localhost" || host.endsWith(".localhost") ||
        host === "milads-mac-mini" || host === "milads-mac-mini.taild31e9a.ts.net") return null;
    const blocked = new BlockList();
    blocked.addSubnet("0.0.0.0", 8);
    blocked.addSubnet("10.0.0.0", 8);
    blocked.addSubnet("127.0.0.0", 8);
    blocked.addSubnet("169.254.0.0", 16);
    blocked.addSubnet("172.16.0.0", 12);
    blocked.addSubnet("192.168.0.0", 16);
    blocked.addSubnet("100.64.0.0", 10);
    blocked.addAddress("::", "ipv6");
    blocked.addAddress("::1", "ipv6");
    blocked.addSubnet("fe80::", 10, "ipv6");
    blocked.addSubnet("fc00::", 7, "ipv6");
    const family = isIP(host);
    const addresses = family ? [{ address: host, family }] : await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every(({ address, family }) => !blocked.check(address, family === 6 ? "ipv6" : "ipv4"))
      ? url
      : null;
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
      const title =
        metaContent(html, "og:title") ??
        (decodeEntities(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "") || null);
      preview = {
        url: url.href,
        title,
        description: metaContent(html, "og:description") ?? metaContent(html, "description"),
        image: metaContent(html, "og:image"),
        siteName: metaContent(html, "og:site_name") ?? url.hostname,
      };
      if (!preview.title && !preview.description && !preview.image) preview = null;
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
