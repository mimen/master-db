export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

function publicIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  return octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && a !== 0 && a !== 10 && a !== 127 && a < 224
    && !(a === 169 && b === 254)
    && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && b === 168)
    && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 198 && (b === 18 || b === 19));
}

/** Pure host check, also used on every address returned by the DNS resolver. */
export function isPublicPreviewHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host.includes(":")) {
    try {
      const canonical = new URL(`http://[${host}]/`).hostname.slice(1, -1);
      const [left, right] = canonical.split("::");
      const start = left ? left.split(":") : [];
      const end = right ? right.split(":") : [];
      const words = (right === undefined ? start : [...start, ...Array<string>(8 - start.length - end.length).fill("0"), ...end])
        .map((word) => Number.parseInt(word, 16));
      if (words.length !== 8) return false;
      // URL canonicalization converts IPv4-mapped addresses to hexadecimal words.
      if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
        return publicIpv4([words[6] >>> 8, words[6] & 255, words[7] >>> 8, words[7] & 255]);
      }
      return !words.slice(0, 6).every((word) => word === 0)
        && (words[0] & 0xfe00) !== 0xfc00
        && (words[0] & 0xffc0) !== 0xfe80
        && (words[0] & 0xffc0) !== 0xfec0
        && (words[0] & 0xff00) !== 0xff00;
    } catch {
      return false;
    }
  }
  if (/^[\d.]+$/.test(host)) return publicIpv4(host.split(".").map(Number));
  return host.includes(".") && !["localhost", "local", "ts.net"].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function parsePublicPreviewUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    return (url.protocol === "http:" || url.protocol === "https:")
      && !url.username && !url.password && isPublicPreviewHost(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity: string, key: string) => {
    if (!key.startsWith("#")) return named[key.toLowerCase()] ?? entity;
    const code = key[1].toLowerCase() === "x" ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

export function extractLinkPreview(html: string, url: URL, originalUrl = url.href): LinkPreview | null {
  const metadata = new Map<string, string>();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map<string, string>();
    for (const attribute of tag[0].matchAll(/([^\s=/'"<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      attributes.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4]);
    }
    const key = attributes.get("property") ?? attributes.get("name");
    const content = attributes.get("content");
    if (key && content?.trim() && !metadata.has(key.toLowerCase())) metadata.set(key.toLowerCase(), decodeEntities(content.trim()));
  }
  const title = metadata.get("og:title") ?? metadata.get("twitter:title")
    ?? (decodeEntities(html.match(/<title\b[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "") || null);
  const description = metadata.get("og:description") ?? metadata.get("twitter:description") ?? metadata.get("description") ?? null;
  const rawImage = metadata.get("og:image") ?? metadata.get("twitter:image") ?? metadata.get("twitter:image:src");
  let image: string | null = null;
  if (rawImage) {
    try { image = parsePublicPreviewUrl(new URL(rawImage, url).href)?.href ?? null; }
    catch { /* Invalid image metadata does not discard the text preview. */ }
  }
  if (!title && !description && !image) return null;
  return { url: originalUrl, title, description, image, siteName: metadata.get("og:site_name") ?? metadata.get("twitter:site") ?? url.hostname };
}
