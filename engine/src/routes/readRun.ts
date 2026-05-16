import { Hono } from "hono";

import type { ConvexStore } from "../store/convex";

interface AgenticRunRow {
  entity_ref: string;
  last_run_id: string | null;
  status: string;
  updated_at: number;
  resume_cursor: unknown | null;
}

interface ThreadRow {
  row_type: "message" | "activity";
  kind: string;
  proposal_json?: unknown;
  sequence: number;
}

function isResumeCursorWithTurn(v: unknown): v is { turn: number } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).turn === "number"
  );
}

export interface ReadRoutesDeps {
  store: ConvexStore;
  isBusy: (entity_ref: string) => boolean;
}

export function createReadRoutes(deps: ReadRoutesDeps): Hono {
  const app = new Hono();

  app.get("/run/:entity_ref", async (c) => {
    const entity_ref = c.req.param("entity_ref");
    const run = (await deps.store.getRun(entity_ref)) as AgenticRunRow | null;
    if (!run) return c.json({ error: "not found" }, 404);
    const thread = (await deps.store.getThread(entity_ref)) as ThreadRow[];
    const lastProposal = [...thread]
      .reverse()
      .find((row) => row.row_type === "message" && row.kind === "proposal");
    return c.json({
      entity_ref,
      run_id: run.last_run_id,
      status: run.status,
      last_proposal: lastProposal?.proposal_json ?? null,
      updated_at: run.updated_at,
    });
  });

  app.get("/run/:entity_ref/status", async (c) => {
    const entity_ref = c.req.param("entity_ref");
    const run = (await deps.store.getRun(entity_ref)) as AgenticRunRow | null;
    if (!run) return c.json({ error: "not found" }, 404);
    return c.json({
      entity_ref,
      run_id: run.last_run_id,
      status: run.status,
      busy: deps.isBusy(entity_ref),
      turn_count: isResumeCursorWithTurn(run.resume_cursor)
        ? run.resume_cursor.turn
        : 0,
      updated_at: run.updated_at,
    });
  });

  return app;
}
