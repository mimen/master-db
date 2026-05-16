import { Hono } from "hono";
import { describe, expect, test } from "vitest";

import type { ConvexStore } from "../store/convex";

import { createReadRoutes } from "./readRun";

interface FakeRun {
  entity_ref: string;
  last_run_id: string | null;
  status: string;
  updated_at: number;
  resume_cursor?: { turn?: number } | null;
}

interface FakeThreadRow {
  row_type: "message" | "activity";
  kind: string;
  proposal_json?: unknown;
  sequence: number;
}

function fakeStore(state: {
  run: FakeRun | null;
  messages: FakeThreadRow[];
}): ConvexStore {
  return {
    async getRun() {
      return state.run;
    },
    async getThread() {
      return state.messages;
    },
    async upsertRun() {
      return "x";
    },
    async appendThreadMessage() {
      return "x";
    },
    async startActivity() {
      return "x";
    },
    async resolveActivity() {},
    async updateRunStatus() {},
  };
}

function buildApp(state: { run: FakeRun | null; messages: FakeThreadRow[] }) {
  const app = new Hono();
  app.route(
    "/",
    createReadRoutes({
      store: fakeStore(state),
      isBusy: () => false,
    }),
  );
  return app;
}

describe("read routes", () => {
  test("GET /run/:entity_ref returns last_proposal", async () => {
    const proposal = {
      kind: "proposal",
      summary: "x",
      options: [],
      free_text_allowed: true,
    };
    const app = buildApp({
      run: {
        entity_ref: "a",
        last_run_id: "01H",
        status: "awaiting_decision",
        updated_at: 1,
      },
      messages: [
        {
          row_type: "message",
          kind: "proposal",
          proposal_json: proposal,
          sequence: 1,
        },
      ],
    });
    const res = await app.request("/run/a");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      last_proposal: unknown;
      status: string;
    };
    expect(body.last_proposal).toEqual(proposal);
    expect(body.status).toBe("awaiting_decision");
  });

  test("GET /run/:entity_ref/status returns minimal payload", async () => {
    const app = buildApp({
      run: {
        entity_ref: "a",
        last_run_id: "01H",
        status: "discovering",
        updated_at: 1,
        resume_cursor: { turn: 3 },
      },
      messages: [],
    });
    const res = await app.request("/run/a/status");
    const body = (await res.json()) as {
      status: string;
      run_id: string;
      turn_count: number;
      busy: boolean;
    };
    expect(body.status).toBe("discovering");
    expect(body.run_id).toBe("01H");
    expect(body.turn_count).toBe(3);
    expect(body.busy).toBe(false);
  });

  test("missing run yields 404", async () => {
    const app = buildApp({ run: null, messages: [] });
    const res = await app.request("/run/none");
    expect(res.status).toBe(404);
  });
});
