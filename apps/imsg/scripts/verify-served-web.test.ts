import { describe, expect, test } from "bun:test";

import { verifyServedWeb } from "./verify-served-web";

describe("served web release verification", () => {
  test("binds rendered HTML to its immutable entry bytes", async () => {
    const sha = "a".repeat(40);
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/") {
          return new Response(`<meta name="comma-web-sha" content="${sha}"><script src="/_expo/static/js/web/entry.js"></script>`);
        }
        return new Response(`bundle ${sha}`, { headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
      },
    });
    try {
      await expect(verifyServedWeb(`http://127.0.0.1:${server.port}`, sha))
        .resolves.toBe("/_expo/static/js/web/entry.js");
    } finally {
      server.stop(true);
    }
  });

  test("rejects stale HTML even when the root and asset return 200", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(`<meta name="comma-web-sha" content="${"b".repeat(40)}"><script src="/entry.js"></script>`);
      },
    });
    try {
      await expect(verifyServedWeb(`http://127.0.0.1:${server.port}`, "c".repeat(40))).rejects.toThrow("served HTML");
    } finally {
      server.stop(true);
    }
  });
});
