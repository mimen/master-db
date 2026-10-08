import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { LinkPreview } from "../../apps/imsg/shared/link-preview";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { createLinkPreviewAction, fetchPreview, type LinkPreviewDependencies } from "./linkPreview";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const previewRef = makeFunctionReference<"action", { url: string }, LinkPreview | null>("comma/linkPreview:fetchLinkPreview");
const url = "https://example.com/page";
const html = (body = "<title>Example</title>") => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
const network = () => ({
  fetch: vi.fn<LinkPreviewDependencies["fetch"]>(async () => html()),
  resolve: vi.fn<LinkPreviewDependencies["resolve"]>(async () => ["93.184.215.14"]),
});
afterEach(() => vi.useRealTimers());

function setup(deps = network()) {
  const actionModules = { ...modules, "../../comma/linkPreview.ts": async () => ({ fetchLinkPreview: createLinkPreviewAction(deps) }) };
  const t = convexTest(schema, actionModules);
  return { t, as: t.withIdentity({ email: ALLOWED_EMAIL }), deps };
}

test("action requires the allowed identity before doing any network work", async () => {
  const { t, as, deps } = setup();
  const deniedId = await t.run((ctx) => ctx.db.insert("users", { email: "other@example.com" }));
  for (const caller of [t, t.withIdentity({ subject: `${deniedId}|session` })]) {
    await expect(caller.action(previewRef, { url })).rejects.toThrow("Unauthorized");
  }
  expect(deps.fetch).not.toHaveBeenCalled();
  expect(deps.resolve).not.toHaveBeenCalled();
  expect(await as.action(previewRef, { url })).toEqual({ url, title: "Example", description: null, image: null, siteName: "example.com" });
  const allowedId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  expect(await t.withIdentity({ subject: `${allowedId}|session` }).action(previewRef, { url })).toMatchObject({ title: "Example" });
});

describe("network validation", () => {
  test.each([
    "not a URL", "file:///etc/passwd", "ftp://8.8.8.8/file", "https://user:password@example.com/",
    "http://localhost/", "http://LOCALHOST./", "http://foo.localhost/", "http://milads-mac-mini/",
    "http://127.0.0.2/", "http://0x7f000001/", "http://2130706433/", "http://0.0.0.0/",
    "http://10.1.2.3/", "http://172.16.0.1/", "http://172.31.255.255/", "http://192.168.1.1/",
    "http://169.254.169.254/", "http://100.64.0.0/", "http://100.127.255.255/",
    "http://198.18.0.1/", "http://224.0.0.1/", "http://240.0.0.1/",
    "http://[::1]/", "http://[::]/", "http://[fe80::1]/", "http://[febf::1]/", "http://[fc00::1]/", "http://[fd00::1]/",
    "http://[::ffff:127.0.0.1]/", "http://[::ffff:192.168.1.1]/", "http://[::ffff:100.64.0.1]/", "http://[ff02::1]/",
    "https://anything.ts.net/", "https://ANYTHING.TS.NET./", "https://ts.net/", "http://printer.local/", "http://PRINTER.LOCAL./",
  ])("blocks %s without fetching or resolving", async (blockedUrl) => {
    const { as, deps } = setup();
    expect(await as.action(previewRef, { url: blockedUrl })).toBeNull();
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.resolve).not.toHaveBeenCalled();
  });

  test.each(["10.1.2.3", "127.0.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:192.168.1.1"])("blocks a public hostname resolving to %s", async (address) => {
    const deps = network();
    deps.resolve.mockResolvedValue([address]);
    expect(await fetchPreview(url, deps)).toBeNull();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  test("rejects mixed public/private DNS answers, no answers, and DNS failures", async () => {
    const deps = network();
    for (const addresses of [["93.184.215.14", "10.0.0.1"], []]) {
      deps.resolve.mockResolvedValue(addresses);
      expect(await fetchPreview(url, deps)).toBeNull();
    }
    deps.resolve.mockRejectedValue(new Error("DNS failed"));
    expect(await fetchPreview(url, deps)).toBeNull();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  test.each(["https://8.8.8.8/", "http://172.32.0.1/", "http://100.128.0.1/", "https://[2606:4700:4700::1111]/", "https://[::ffff:8.8.8.8]/"])("accepts public literal %s without DNS", async (publicUrl) => {
    const deps = network();
    expect(await fetchPreview(publicUrl, deps)).toMatchObject({ title: "Example" });
    expect(deps.resolve).not.toHaveBeenCalled();
  });
});

describe("redirects and limits", () => {
  test.each(["http://10.0.0.1/", "https://anything.ts.net/", "http://[fd00::1]/"])("refuses redirect to %s", async (location) => {
    const deps = network();
    deps.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { Location: location } }));
    expect(await fetchPreview(url, deps)).toBeNull();
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  test("rechecks DNS on redirect and refuses a private answer", async () => {
    const deps = network();
    deps.resolve.mockResolvedValueOnce(["93.184.215.14"]).mockResolvedValueOnce(["192.168.1.1"]);
    deps.fetch.mockResolvedValue(new Response(null, { status: 301, headers: { Location: "https://redirect.example.com/" } }));
    expect(await fetchPreview(url, deps)).toBeNull();
    expect(deps.resolve).toHaveBeenNthCalledWith(2, "redirect.example.com");
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  test("allows three validated redirects, resolves images against the final URL, and retains the original URL", async () => {
    const deps = network();
    deps.fetch
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { Location: "/one" } }))
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { Location: "https://other.example.com/two" } }))
      .mockResolvedValueOnce(new Response(null, { status: 308, headers: { Location: "/final/page" } }))
      .mockResolvedValueOnce(html('<title>Final</title><meta property="og:image" content="../image.jpg">'));
    expect(await fetchPreview(url, deps)).toMatchObject({ url, title: "Final", image: "https://other.example.com/image.jpg", siteName: "other.example.com" });
    expect(deps.fetch).toHaveBeenCalledTimes(4);
    expect(deps.resolve).toHaveBeenCalledTimes(5);
    expect(deps.fetch.mock.calls.every(([, init]) => init.redirect === "manual")).toBe(true);
  });

  test("refuses a fourth redirect, missing Location, invalid Location, and fetch failure", async () => {
    const deps = network();
    deps.fetch.mockImplementation(async () => new Response(null, { status: 302, headers: { Location: "/again" } }));
    expect(await fetchPreview(url, deps)).toBeNull();
    expect(deps.fetch).toHaveBeenCalledTimes(4);
    for (const location of [null, "http://["]) {
      deps.fetch.mockResolvedValue(new Response(null, { status: 302, headers: location ? { Location: location } : {} }));
      expect(await fetchPreview(url, deps)).toBeNull();
    }
    deps.fetch.mockRejectedValue(new Error("fetch failed"));
    expect(await fetchPreview(url, deps)).toBeNull();
  });

  test.each(["dns", "fetch", "body"])("five-second deadline includes stalled %s", async (stage) => {
    vi.useFakeTimers();
    const deps = network();
    let cancelled = false;
    if (stage === "dns") deps.resolve.mockImplementation(() => new Promise(() => {}));
    if (stage === "fetch") deps.fetch.mockImplementation(() => new Promise(() => {}));
    if (stage === "body") deps.fetch.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }), { headers: { "Content-Type": "text/html" } }));
    const result = fetchPreview(url, deps);
    await vi.advanceTimersByTimeAsync(4_999);
    let completed = false;
    void result.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBeNull();
    if (stage !== "dns") expect(deps.fetch.mock.calls[0][1].signal?.aborted).toBe(true);
    if (stage === "body") expect(cancelled).toBe(true);
  });

  test("reads at most 512 KiB and cancels the body at the cap", async () => {
    const deps = network();
    const cancel = vi.fn();
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks++;
        controller.enqueue(new TextEncoder().encode(chunks === 1 ? " ".repeat(512 * 1024) : "<title>Beyond cap</title>"));
      },
      cancel,
    }, { highWaterMark: 0 });
    deps.fetch.mockResolvedValue(new Response(body, { headers: { "Content-Type": "text/html" } }));
    expect(await fetchPreview(url, deps)).toBeNull();
    expect(chunks).toBe(1);
    expect(cancel).toHaveBeenCalled();
  });

  test("clips a single oversized chunk before extracting metadata", async () => {
    const deps = network();
    deps.fetch.mockResolvedValue(html(" ".repeat(512 * 1024) + "<title>Beyond cap</title>"));
    expect(await fetchPreview(url, deps)).toBeNull();
  });

  test.each(["image/png", "application/json", "text/html-not-really", ""])("returns null for content type %s", async (contentType) => {
    const deps = network();
    deps.fetch.mockResolvedValue(new Response("<title>Ignored</title>", { headers: { "Content-Type": contentType } }));
    expect(await fetchPreview(url, deps)).toBeNull();
  });

  test("returns null for HTTP errors and HTML without metadata", async () => {
    const deps = network();
    deps.fetch.mockResolvedValue(new Response("<title>Error</title>", { status: 404, headers: { "Content-Type": "text/html" } }));
    expect(await fetchPreview(url, deps)).toBeNull();
    deps.fetch.mockResolvedValue(html("<html><body>Empty</body></html>"));
    expect(await fetchPreview(url, deps)).toBeNull();
  });
});

describe("metadata", () => {
  test("Open Graph takes precedence over Twitter and title fallbacks", async () => {
    const deps = network();
    deps.fetch.mockResolvedValue(html(`<title>Fallback</title>
      <meta name="twitter:title" content="Twitter"><meta property="og:title" content="OG &amp; title">
      <meta content='It is "quoted" &#39;text&#39;' property="og:description">
      <meta property="og:image" content="/image.jpg"><meta property="og:site_name" content="Example Site">`));
    expect(await fetchPreview(url, deps)).toEqual({ url, title: "OG & title", description: 'It is "quoted" \'text\'', image: "https://example.com/image.jpg", siteName: "Example Site" });
  });

  test("Twitter supplies title, description, image, and site name", async () => {
    const deps = network();
    deps.fetch.mockResolvedValue(html(`<title>Fallback</title><meta name="twitter:title" content="Tweet title">
      <meta name="twitter:description" content="Tweet description"><meta name="twitter:image" content="image.jpg">
      <meta name="twitter:site" content="@example">`));
    expect(await fetchPreview(url, deps)).toEqual({ url, title: "Tweet title", description: "Tweet description", image: "https://example.com/image.jpg", siteName: "@example" });
  });

  test("title and standard description are fallbacks, and metadata is case insensitive", async () => {
    const deps = network();
    deps.fetch.mockResolvedValue(html('<TITLE>  Fallback &lt;title&gt; &#x27;ok&#39; </TITLE><META NAME="DESCRIPTION" CONTENT="Description">'));
    expect(await fetchPreview(url, deps)).toEqual({ url, title: "Fallback <title> 'ok'", description: "Description", image: null, siteName: "example.com" });
  });

  test.each(["http://10.0.0.1/image", "http://[fd00::1]/image", "https://anything.ts.net/image", "javascript:alert(1)"])("discards unsafe image metadata %s", async (image) => {
    const deps = network();
    deps.fetch.mockResolvedValue(html(`<title>Safe text</title><meta property="og:image" content="${image}">`));
    expect(await fetchPreview(url, deps)).toMatchObject({ title: "Safe text", image: null });
  });

  test("drops an image host that resolves to a private address", async () => {
    const deps = network();
    deps.resolve.mockImplementation(async (hostname: string) => hostname === "localtest.me" ? ["127.0.0.1"] : ["93.184.215.14"]);
    deps.fetch.mockResolvedValue(html('<title>Safe text</title><meta property="og:image" content="https://localtest.me/secret">'));
    expect(await fetchPreview(url, deps)).toMatchObject({ title: "Safe text", image: null });
    expect(deps.resolve).toHaveBeenCalledWith("localtest.me");
  });
});

test("a resolver completing after the deadline cannot start a late fetch", async () => {
  vi.useFakeTimers();
  const deps = network();
  let finishResolve!: (addresses: string[]) => void;
  deps.resolve.mockImplementation(() => new Promise((resolve) => { finishResolve = resolve; }));
  const result = fetchPreview(url, deps);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await result).toBeNull();
  finishResolve(["93.184.215.14"]);
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.fetch).not.toHaveBeenCalled();
});

test("redirects share the five-second deadline instead of restarting it", async () => {
  vi.useFakeTimers();
  const deps = network();
  deps.fetch.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    return new Response(null, { status: 302, headers: { Location: "/again" } });
  });
  const result = fetchPreview(url, deps);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await result).toBeNull();
  expect(deps.fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(deps.fetch).toHaveBeenCalledTimes(2);
});

test("same-host redirects still revalidate DNS", async () => {
  const deps = network();
  deps.resolve.mockResolvedValueOnce(["93.184.215.14"]).mockResolvedValueOnce(["100.64.0.1"]);
  deps.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { Location: "/next" } }));
  expect(await fetchPreview(url, deps)).toBeNull();
  expect(deps.resolve).toHaveBeenNthCalledWith(2, "example.com");
  expect(deps.fetch).toHaveBeenCalledTimes(1);
});

test("XHTML and Twitter's image:src fallback retain the same preview shape", async () => {
  const deps = network();
  deps.fetch.mockResolvedValue(new Response('<meta name="twitter:image:src" content="//images.example.com/photo.jpg">', { headers: { "Content-Type": "Application/XHTML+XML; charset=utf-8" } }));
  expect(await fetchPreview(url, deps)).toEqual({ url, title: null, description: null, image: "https://images.example.com/photo.jpg", siteName: "example.com" });
});
