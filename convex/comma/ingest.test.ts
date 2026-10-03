import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { ingestKind } from "./ingest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const SECRET = "test-bridge-secret";
const previous = process.env.COMMA_BRIDGE_SECRET;

beforeEach(() => {
  process.env.COMMA_BRIDGE_SECRET = SECRET;
});
afterEach(() => {
  if (previous === undefined) delete process.env.COMMA_BRIDGE_SECRET;
  else process.env.COMMA_BRIDGE_SECRET = previous;
});

const scheduled = {
  items: [{ bbId: 7, chatGuid: "iMessage;-;+15550001111", text: "hi", sendAt: 5, status: "pending" }],
};

function post(path: string, body: unknown, token: string | null = SECRET) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    path,
  };
}

describe("ingestKind", () => {
  test("maps known paths and rejects unknown ones", () => {
    expect(ingestKind("/comma/ingest/messages")).toBe("messages");
    expect(ingestKind("/comma/ingest/toString")).toBeNull();
    expect(ingestKind("/comma/ingest/nope")).toBeNull();
  });
});

describe("POST /comma/ingest/*", () => {
  test("rejects a missing or wrong bearer token", async () => {
    const t = convexTest(schema, modules);
    const { path, ...init } = post("/comma/ingest/scheduled", scheduled, "wrong");
    const response = await t.fetch(path, init);
    expect(response.status).toBe(401);
  });

  test("routes a valid body to its mutation", async () => {
    const t = convexTest(schema, modules);
    const { path, ...init } = post("/comma/ingest/scheduled", scheduled);
    const response = await t.fetch(path, init);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: { upserted: 1, deleted: 0 } });
    const rows = await t.run((ctx) => ctx.db.query("comma_scheduled").collect());
    expect(rows.map((row) => row.bbId)).toEqual([7]);
  });

  test("returns 400 when the body fails the mutation's validator", async () => {
    const t = convexTest(schema, modules);
    const { path, ...init } = post("/comma/ingest/scheduled", { items: [{ bbId: "seven" }] });
    const response = await t.fetch(path, init);
    expect(response.status).toBe(400);
  });

  test("returns 404 for an unknown kind", async () => {
    const t = convexTest(schema, modules);
    const { path, ...init } = post("/comma/ingest/nope", {});
    const response = await t.fetch(path, init);
    expect(response.status).toBe(404);
  });
});
