import { describe, expect, test } from "vitest";

import { loadEnv } from "./env";

describe("loadEnv", () => {
  test("parses a valid env", () => {
    const env = loadEnv({
      AGENTIC_SERVER_TOKEN: "tok-12345678",
      CONVEX_URL: "https://x.convex.cloud",
      PORT: "8787",
      LOG_DIR: "/tmp/agentic-logs",
    });
    expect(env.token).toBe("tok-12345678");
    expect(env.convexUrl).toBe("https://x.convex.cloud");
    expect(env.port).toBe(8787);
    expect(env.logDir).toBe("/tmp/agentic-logs");
  });

  test("rejects missing token", () => {
    expect(() =>
      loadEnv({ CONVEX_URL: "https://x.convex.cloud" }),
    ).toThrow(/AGENTIC_SERVER_TOKEN/);
  });

  test("rejects non-numeric port", () => {
    expect(() =>
      loadEnv({
        AGENTIC_SERVER_TOKEN: "tok-12345678",
        CONVEX_URL: "https://x.convex.cloud",
        PORT: "not-a-port",
      }),
    ).toThrow();
  });

  test("defaults port to 8787 when omitted", () => {
    const env = loadEnv({
      AGENTIC_SERVER_TOKEN: "tok-12345678",
      CONVEX_URL: "https://x.convex.cloud",
    });
    expect(env.port).toBe(8787);
  });
});
