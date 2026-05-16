import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createEchoRunner } from "../src/runner/echoRunner";
import { buildServer } from "../src/server";
import type { ConvexClientLike } from "../src/store/convex";

const fakeConvex = {
  query: vi.fn(async () => null),
  mutation: vi.fn(async () => "ID"),
} as unknown as ConvexClientLike;

let logDir: string;
beforeEach(() => {
  logDir = mkdtempSync(join(tmpdir(), "agentic-integration-"));
});
afterEach(() => {
  rmSync(logDir, { recursive: true, force: true });
});

describe("server end-to-end with EchoRunner", () => {
  test("POST /run produces 200 with run_id and accepted:true", async () => {
    const app = buildServer({
      token: "tok",
      convexClient: fakeConvex,
      runner: createEchoRunner(),
      sources: { fetch: async () => ({ content: "x" }) },
      logDir,
      now: () => Date.now(),
    });
    const res = await app.request("/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer tok",
      },
      body: JSON.stringify({ entity_ref: "todoist:task:abc" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accepted: boolean;
      run_id: string;
    };
    expect(body.accepted).toBe(true);
    expect(body.run_id).toMatch(/[0-9A-Z]{10,}/);
  });

  test("missing auth → 401", async () => {
    const app = buildServer({
      token: "tok",
      convexClient: fakeConvex,
      runner: createEchoRunner(),
      sources: { fetch: async () => ({ content: "x" }) },
      logDir,
      now: () => Date.now(),
    });
    const res = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity_ref: "todoist:task:abc" }),
    });
    expect(res.status).toBe(401);
  });

  test("GET /healthz does not require auth", async () => {
    const app = buildServer({
      token: "tok",
      convexClient: fakeConvex,
      runner: createEchoRunner(),
      sources: { fetch: async () => ({ content: "x" }) },
      logDir,
      now: () => Date.now(),
    });
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
