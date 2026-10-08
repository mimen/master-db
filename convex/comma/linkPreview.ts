"use node";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { v } from "convex/values";

import { extractLinkPreview, isPublicPreviewHost, parsePublicPreviewUrl, type LinkPreview } from "../../apps/imsg/shared/link-preview";
import { action } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";

const TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface LinkPreviewDependencies {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  resolve: (hostname: string) => Promise<string[]>;
}

const dependencies: LinkPreviewDependencies = {
  fetch: (url, init) => fetch(url, init),
  resolve: async (hostname) => (await lookup(hostname, { all: true })).map(({ address }) => address),
};

async function allowedUrl(rawUrl: string, resolve: LinkPreviewDependencies["resolve"]): Promise<URL | null> {
  const url = parsePublicPreviewUrl(rawUrl);
  if (!url) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const addresses = isIP(host) ? [host] : await resolve(host);
  return addresses.length > 0 && addresses.every((address) => isIP(address) && isPublicPreviewHost(address)) ? url : null;
}

function cancelBody(response: Response): void {
  void response.body?.cancel().catch(() => {});
}

async function readHtml(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  try {
    while (bytes < MAX_HTML_BYTES && !signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, MAX_HTML_BYTES - bytes);
      bytes += chunk.byteLength;
      html += decoder.decode(chunk, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

/** Inject both network boundaries so tests never resolve or fetch real hosts. */
export async function fetchPreview(rawUrl: string, deps: LinkPreviewDependencies): Promise<LinkPreview | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Link preview timed out"));
      controller.abort();
    }, TIMEOUT_MS);
  });
  const load = async (): Promise<LinkPreview | null> => {
    let nextUrl = rawUrl;
    let originalUrl: string | undefined;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const url = await allowedUrl(nextUrl, deps.resolve);
      if (!url || controller.signal.aborted) return null;
      originalUrl ??= url.href;
      const response = await deps.fetch(url.href, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; CommaLinkPreview/1.0)",
          Accept: "text/html, application/xhtml+xml",
        },
      });
      if (controller.signal.aborted) { cancelBody(response); return null; }
      if (REDIRECT_STATUSES.has(response.status)) {
        cancelBody(response);
        const location = response.headers.get("location");
        if (!location || redirects === MAX_REDIRECTS) return null;
        nextUrl = new URL(location, url).href;
        continue;
      }
      const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      if (!response.ok || (contentType !== "text/html" && contentType !== "application/xhtml+xml")) {
        cancelBody(response);
        return null;
      }
      const html = await readHtml(response, controller.signal);
      if (controller.signal.aborted) return null;
      const preview = extractLinkPreview(html, url, originalUrl);
      // The app loads this URL itself, so a public name that resolves private never hits the page-host check.
      if (!preview?.image) return preview;
      const imageUrl = await allowedUrl(preview.image, deps.resolve);
      if (controller.signal.aborted) return null;
      if (imageUrl) return preview;
      const stripped = { ...preview, image: null };
      return stripped.title || stripped.description ? stripped : null;
    }
    return null;
  };
  try {
    return await Promise.race([load(), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export function createLinkPreviewAction(deps: LinkPreviewDependencies) {
  return action({
    args: { url: v.string() },
    returns: v.union(v.null(), v.object({
      url: v.string(), title: v.union(v.string(), v.null()), description: v.union(v.string(), v.null()),
      image: v.union(v.string(), v.null()), siteName: v.union(v.string(), v.null()),
    })),
    handler: async (ctx, { url }): Promise<LinkPreview | null> => {
      await assertAllowed(ctx);
      return fetchPreview(url, deps);
    },
  });
}

export const fetchLinkPreview = createLinkPreviewAction(dependencies);
