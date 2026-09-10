import { describe, expect, test } from "bun:test";
import { parsePreviewUrl } from "./link-preview";

describe("parsePreviewUrl", () => {
  test.each([
    "not a URL", "file:///etc/passwd", "ftp://8.8.8.8/file", "http://localhost/",
    "http://LOCALHOST./", "http://foo.localhost/", "http://127.0.0.2/", "http://0x7f000001/",
    "http://2130706433/", "http://0.0.0.0/", "http://10.1.2.3/", "http://172.16.0.1/",
    "http://172.31.255.255/", "http://192.168.1.1/", "http://169.254.169.254/",
    "http://[::1]/", "http://[::]/", "http://[fe80::1]/", "http://[febf::1]/", "http://[fd00::1]/",
    "http://[::ffff:127.0.0.1]/", "http://[::ffff:192.168.1.1]/", "http://100.126.205.128/",
    "https://milads-mac-mini.taild31e9a.ts.net:8447/", "https://MILADS-MAC-MINI.taild31e9a.ts.net./",
    "http://milads-mac-mini/",
  ])("rejects %s", async (url) => {
    expect(await parsePreviewUrl(url)).toBeNull();
  });

  test.each(["https://8.8.8.8/", "http://172.32.0.1/", "https://[2606:4700:4700::1111]/"])("accepts %s", async (url) => {
    expect((await parsePreviewUrl(url))?.href).toBe(url);
  });
});
