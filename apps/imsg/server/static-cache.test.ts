import { describe, expect, test } from "bun:test";

import { staticCacheControl } from "./static-cache";

describe("staticCacheControl", () => {
  test("HTML and the SPA entry are never cached", () => {
    expect(staticCacheControl("/")).toBe("no-store");
    expect(staticCacheControl("/index.html")).toBe("no-store");
    expect(staticCacheControl("/chat/abc.html")).toBe("no-store");
    expect(staticCacheControl("/manifest.webmanifest")).toBe("no-store");
  });

  test("hashed Expo assets are immutable", () => {
    expect(staticCacheControl("/_expo/static/js/web/entry-abc.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(staticCacheControl("/_expo/static/css/global-abc.css")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  test("everything else revalidates", () => {
    expect(staticCacheControl("/icon-512.png")).toBe("no-cache");
    expect(staticCacheControl("/favicon.ico")).toBe("no-cache");
  });
});
