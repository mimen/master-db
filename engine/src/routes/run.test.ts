import { Hono } from "hono";
import { describe, expect, test, vi } from "vitest";

import { createIdempotencyCache } from "../concurrency/idempotencyCache";
import { createPerEntityQueue } from "../concurrency/perEntityQueue";
import { createEchoRunner } from "../runner/echoRunner";
import type { ConvexStore } from "../store/convex";

import { createRunRoutes } from "./run";

interface FakeRunRow {
  entity_ref: string;
  entity_type: string;
  entity_id: string;
  backend: string;
  status: string;
  last_run_id: string | null;
  last_message_id: string | null;
  last_traceparent: string | null;
  resume_cursor: unknown | null;
  _id: string;
}

interface FakeStoreState {
  run: FakeRunRow | null;
  messages: Array<Record<string, unknown> & { _id: string; kind: string; run_id: string; checkpoint_id: string | null }>;
  activities: Array<Record<string, unknown> & { _id: string; status: string }>;
}

function fakeStore(): ConvexStore & { state: FakeStoreState } {
  const state: FakeStoreState = { run: null, messages: [], activities: [] };
  return {
    state,
    async getRun() {
      return state.run;
    },
    async getThread() {
      return [];
    },
    async upsertRun(args) {
      state.run = {
        entity_ref: args.entity_ref,
        entity_type: args.entity_type,
        entity_id: args.entity_id,
        backend: args.backend,
        status: args.status,
        last_run_id: args.run_id,
        last_message_id: state.run?.last_message_id ?? null,
        last_traceparent: args.traceparent,
        resume_cursor: args.resume_cursor,
        _id: "RUN1",
      };
      return "RUN1";
    },
    async appendThreadMessage(args) {
      const _id = `MSG${state.messages.length + 1}`;
      state.messages.push({ ...args, _id });
      return _id;
    },
    async startActivity(args) {
      const _id = `ACT${state.activities.length + 1}`;
      state.activities.push({ ...args, _id, status: "pending" });
      return _id;
    },
    async resolveActivity({ id, status, output_json }) {
      const a = state.activities.find((x) => x._id === id);
      if (a) Object.assign(a, { status, output_json });
    },
    async updateRunStatus(args) {
      if (state.run) state.run = { ...state.run, ...args };
    },
  };
}

function buildApp() {
  const store = fakeStore();
  const queue = createPerEntityQueue({ onInterrupt: async () => {} });
  const cache = createIdempotencyCache({ ttlMs: 10_000 });
  const runner = createEchoRunner();
  const app = new Hono();
  app.route(
    "/",
    createRunRoutes({
      store,
      queue,
      cache,
      runner,
      sources: {
        fetch: async () => ({ id: "abc", content: "do thing" }),
      },
      ndjson: { append: async () => {} },
      webhookDeliver: vi.fn(async () => ({
        delivered: true,
        attempts: 1,
        finalStatus: 200,
      })),
    }),
  );
  return { app, store, queue };
}

describe("POST /run", () => {
  test("kicks off a discovery and writes a proposal", async () => {
    const { app, store, queue } = buildApp();
    const res = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity_ref: "todoist:task:abc" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entity_ref: string;
      run_id: string;
      status: string;
      accepted: boolean;
    };
    expect(body.entity_ref).toBe("todoist:task:abc");
    expect(body.accepted).toBe(true);
    expect(body.run_id).toMatch(/[0-9A-Z]{10,}/);
    await queue.drainAll();
    const proposal = store.state.messages.find((m) => m.kind === "proposal");
    expect(proposal).toBeTruthy();
    expect(proposal?.run_id).toBe(body.run_id);
    expect(proposal?.checkpoint_id).toBeTruthy();
    expect(store.state.run?.status).toBe("awaiting_decision");
  });

  test("null message against existing run returns accepted:false", async () => {
    const { app, queue } = buildApp();
    await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity_ref: "todoist:task:abc" }),
    });
    await queue.drainAll();
    const res = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity_ref: "todoist:task:abc" }),
    });
    const body = (await res.json()) as { accepted: boolean };
    expect(body.accepted).toBe(false);
  });

  test("multitask_strategy=reject while busy returns 409", async () => {
    const { app, queue } = buildApp();
    const p1 = app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity_ref: "todoist:task:abc" }),
    });
    const res2 = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entity_ref: "todoist:task:abc",
        message: "hello",
        multitask_strategy: "reject",
      }),
    });
    expect(res2.status).toBe(409);
    await p1;
    await queue.drainAll();
  });

  test("idempotency-key returns identical cached response body", async () => {
    const { app } = buildApp();
    const r1 = await app.request("/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "kx",
      },
      body: JSON.stringify({ entity_ref: "todoist:task:abc" }),
    });
    const r2 = await app.request("/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "kx",
      },
      body: JSON.stringify({ entity_ref: "todoist:task:abc" }),
    });
    const t1 = await r1.text();
    const t2 = await r2.text();
    expect(t1).toBe(t2);
  });
});
