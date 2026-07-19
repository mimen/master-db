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

function isFetchable(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\])/.test(host)) {
    return false;
  }
  return true;
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!isFetchable(url)) return null;

  const cached = cache.get(url.href);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.preview;

  let preview: LinkPreview | null = null;
  try {
    const res = await fetch(url.href, {
      redirect: "follow",
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
