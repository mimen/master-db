import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { registerConvexTokenRoute, type ConvexAuthClient } from "./convex-token";

const HOUR = 60 * 60 * 1000;

function jwt(expiresAtMs: number, label: string): string {
  const payload = Buffer.from(JSON.stringify({ exp: expiresAtMs / 1000, label })).toString("base64url");
  return `header.${payload}.signature`;
}

type Call = { provider?: string; secret?: unknown; refreshToken?: string };

function harness(options: {
  respond: (call: Call, clock: number) => Promise<{ tokens: { token: string; refreshToken: string } | null }>;
  config?: { convexCloudUrl: string | null; commaBridgeSecret: string | null };
}) {
  let clock = 1_000 * HOUR;
  const calls: Call[] = [];
  const client: ConvexAuthClient = {
    action: async (_reference, args) => {
      const call: Call = "refreshToken" in args
        ? { refreshToken: args.refreshToken }
        : { provider: args.provider, secret: args.params.secret };
      calls.push(call);
      return options.respond(call, clock);
    },
  };
  const app = new Hono();
  registerConvexTokenRoute(
    app,
    options.config ?? { convexCloudUrl: "https://example.convex.cloud", commaBridgeSecret: "s3cret" },
    { client, now: () => clock },
  );
  return {
    calls,
    advance: (ms: number) => { clock += ms; },
    get: async (path = "/api/convex-token") => {
      const response = await app.request(path);
      return { status: response.status, body: await response.json() as { token?: string; error?: string } };
    },
  };
}

describe("GET /api/convex-token", () => {
  test("signs in with the tailnet secret once and reuses the cached token", async () => {
    const h = harness({ respond: async (_call, now) => ({ tokens: { token: jwt(now + HOUR, "a"), refreshToken: "r1" } }) });
    const first = await h.get();
    const second = await h.get();
    expect(first).toEqual({ status: 200, body: { token: jwt(1_001 * HOUR, "a") } });
    expect(second.body.token).toBe(first.body.token);
    expect(h.calls).toEqual([{ provider: "tailnet", secret: "s3cret" }]);
  });

  test("refreshes within ten minutes of expiry and on ?refresh=1", async () => {
    let n = 0;
    const h = harness({ respond: async (_call, now) => ({ tokens: { token: jwt(now + HOUR, `t${++n}`), refreshToken: `r${n}` } }) });
    await h.get();
    h.advance(HOUR - 9 * 60 * 1000);
    await h.get();
    await h.get("/api/convex-token?refresh=1");
    expect(h.calls).toEqual([
      { provider: "tailnet", secret: "s3cret" },
      { refreshToken: "r1" },
      { refreshToken: "r2" },
    ]);
  });

  test("falls back to the secret when the refresh token is rejected", async () => {
    const h = harness({
      respond: async (call, now) => {
        if (call.refreshToken) throw new Error("expired refresh token");
        return { tokens: { token: jwt(now + HOUR, "fresh"), refreshToken: "r" } };
      },
    });
    await h.get();
    const refreshed = await h.get("/api/convex-token?refresh=1");
    expect(refreshed.status).toBe(200);
    expect(h.calls).toEqual([
      { provider: "tailnet", secret: "s3cret" },
      { refreshToken: "r" },
      { provider: "tailnet", secret: "s3cret" },
    ]);
  });

  test("coalesces concurrent requests into one sign-in", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = harness({
      respond: async (_call, now) => {
        await gate;
        return { tokens: { token: jwt(now + HOUR, "once"), refreshToken: "r" } };
      },
    });
    const pending = Promise.all([h.get(), h.get(), h.get()]);
    release();
    const results = await pending;
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(h.calls).toHaveLength(1);
  });

  test("returns 503 when unconfigured or when Convex refuses", async () => {
    const unconfigured = harness({
      respond: async () => ({ tokens: null }),
      config: { convexCloudUrl: "https://example.convex.cloud", commaBridgeSecret: null },
    });
    expect(await unconfigured.get()).toEqual({ status: 503, body: { error: "Convex session unavailable" } });
    expect(unconfigured.calls).toEqual([]);

    const refused = harness({ respond: async () => ({ tokens: null }) });
    expect((await refused.get()).status).toBe(503);
  });
});
