import { Hono } from "hono";

import type { PerEntityQueue } from "../concurrency/perEntityQueue";
import type { ConvexStore } from "../store/convex";

interface AgenticRunRow {
  status: string;
  last_run_id: string | null;
}

export interface InterruptDeps {
  queue: PerEntityQueue;
  store: ConvexStore;
}

export function createInterruptRoute(deps: InterruptDeps): Hono {
  const app = new Hono();
  app.post("/run/:entity_ref/interrupt", async (c) => {
    const entity_ref = c.req.param("entity_ref");
    deps.queue.interrupt(entity_ref);
    const run = (await deps.store.getRun(entity_ref)) as AgenticRunRow | null;
    return c.json({
      entity_ref,
      run_id: run?.last_run_id ?? null,
      status: run?.status ?? "idle",
      accepted: true,
    });
  });
  return app;
}
