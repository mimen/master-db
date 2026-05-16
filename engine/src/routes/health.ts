import { Hono } from "hono";

export interface HealthDeps {
  startedAt: number;
  inflightCount: () => number;
  lastError: () => { ts: number; message: string } | null;
  convexOk: () => boolean;
}

export function createHealthRoute(deps: HealthDeps): Hono {
  const app = new Hono();
  app.get("/healthz", (c) =>
    c.json({
      ok: deps.convexOk(),
      uptime_ms: Date.now() - deps.startedAt,
      inflight: deps.inflightCount(),
      last_error: deps.lastError(),
      convex_ok: deps.convexOk(),
    }),
  );
  return app;
}
