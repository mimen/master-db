import { describe, expect, test } from "bun:test";
import { extractLinkPreview, isPublicPreviewHost, parsePublicPreviewUrl } from "./link-preview";

describe("shared link preview helpers", () => {
  test.each(["device.ts.net", "DEVICE.TS.NET.", "printer.local", "localhost", "100.64.0.1", "::ffff:100.64.0.1", "fd00::1", "fe80::1"])("rejects host %s", (host) => {
    expect(isPublicPreviewHost(host)).toBe(false);
  });

  test("normalizes unusual IPv4 URLs before checking the host", () => {
    expect(parsePublicPreviewUrl("http://0x7f000001/")).toBeNull();
    expect(parsePublicPreviewUrl("http://2130706433/")).toBeNull();
    expect(parsePublicPreviewUrl("https://Example.com/page")?.href).toBe("https://example.com/page");
  });

  test("shares Twitter fallback extraction and relative image resolution", () => {
    expect(extractLinkPreview('<meta name="twitter:title" content="Title &amp; more"><meta name="twitter:image" content="../photo.jpg">', new URL("https://example.com/pages/article"))).toEqual({
      url: "https://example.com/pages/article", title: "Title & more", description: null,
      image: "https://example.com/photo.jpg", siteName: "example.com",
    });
  });

  test("falls back to title, discards private image metadata, and returns null for empty pages", () => {
    const url = new URL("https://example.com/");
    expect(extractLinkPreview('<title>Title</title><meta property="og:image" content="http://10.0.0.1/photo">', url)).toMatchObject({ title: "Title", image: null });
    expect(extractLinkPreview("<body>No metadata</body>", url)).toBeNull();
  });
});
