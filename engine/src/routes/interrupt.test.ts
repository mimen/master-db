import { Hono } from "hono";
import { describe, expect, test, vi } from "vitest";

import type { PerEntityQueue } from "../concurrency/perEntityQueue";
import type { ConvexStore } from "../store/convex";

import { createInterruptRoute } from "./interrupt";

function buildApp(opts: { isBusy: boolean; status: string }) {
  const interrupt = vi.fn();
  const queue: PerEntityQueue = {
    interrupt,
    isBusy: () => opts.isBusy,
    enqueue: vi.fn(),
    drainAll: vi.fn(async () => {}),
  };
  const store: ConvexStore = {
    async getRun() {
      return { status: opts.status, last_run_id: "01H" };
    },
    async getThread() {
      return [];
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
  const app = new Hono();
  app.route("/", createInterruptRoute({ queue, store }));
  return { app, interrupt };
}

describe("POST /run/:entity_ref/interrupt", () => {
  test("calls queue.interrupt and returns status", async () => {
    const { app, interrupt } = buildApp({
      isBusy: true,
      status: "discovering",
    });
    const res = await app.request("/run/a/interrupt", { method: "POST" });
    expect(res.status).toBe(200);
    expect(interrupt).toHaveBeenCalledWith("a");
  });

  test("idempotent when nothing is running", async () => {
    const { app, interrupt } = buildApp({
      isBusy: false,
      status: "awaiting_decision",
    });
    const res = await app.request("/run/a/interrupt", { method: "POST" });
    expect(res.status).toBe(200);
    expect(interrupt).toHaveBeenCalled();
  });
});
