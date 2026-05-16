import { Hono } from "hono";
import { describe, expect, test } from "vitest";

import { createHealthRoute } from "./health";

describe("GET /healthz", () => {
  test("returns ok and counters", async () => {
    const app = new Hono();
    app.route(
      "/",
      createHealthRoute({
        startedAt: Date.now() - 1000,
        inflightCount: () => 3,
        lastError: () => null,
        convexOk: () => true,
      }),
    );
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      uptime_ms: number;
      inflight: number;
      convex_ok: boolean;
      last_error: { ts: number; message: string } | null;
    };
    expect(body.ok).toBe(true);
    expect(body.uptime_ms).toBeGreaterThanOrEqual(1000);
    expect(body.inflight).toBe(3);
    expect(body.convex_ok).toBe(true);
    expect(body.last_error).toBeNull();
  });
});
