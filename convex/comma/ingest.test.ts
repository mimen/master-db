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
    expect(ingestKind("/comma/ingest/renew")).toBe("renew");
    expect(ingestKind("/comma/ingest/photo")).toBe("photo");
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

  test("routes storage and reports missing attachments for retry", async () => {
    const t = convexTest(schema, modules);
    expect(ingestKind("/comma/ingest/storage")).toBe("storage");
    const { path, ...init } = post("/comma/ingest/storage", { guid: "missing" });
    const response = await t.fetch(path, init);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: false });
    const invalid = post(path, { guid: "missing", thumbStorageId: "not-a-storage-id" });
    expect((await t.fetch(path, { ...init, body: invalid.body })).status).toBe(400);
  });

  test("photo ingest authenticates, validates storage IDs, and reports unmatched addresses", async () => {
    const t = convexTest(schema, modules);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["photo"])));
    const { path, ...init } = post("/comma/ingest/photo", { address: "unknown@example.com", storageId, hash: "a".repeat(64) });
    const response = await t.fetch(path, init);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: false });
    expect((await t.fetch(path, { ...init, headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await t.fetch(path, { ...init, body: JSON.stringify({ address: "unknown", storageId: "bad", hash: "a".repeat(64) }) })).status).toBe(400);
  });

  test("returns 404 for an unknown kind", async () => {
    const t = convexTest(schema, modules);
    const { path, ...init } = post("/comma/ingest/nope", {});
    const response = await t.fetch(path, init);
    expect(response.status).toBe(404);
  });
});

test("suggestions ingest authenticates, validates the payload, and upserts the shelf", async () => {
  const t = convexTest(schema, modules);
  const conversationId = await t.run((ctx) => ctx.db.insert("comma_conversations", {
    conversationKey: "dm:one", primaryChatGuid: "iMessage;-;one", chatGuids: ["iMessage;-;one"],
    displayName: "Alex", participants: [{ address: "one", name: "Alex" }], isGroup: false,
    isSpam: false, hasGroupPhoto: false, lastMessageAt: 1, updatedAt: 1,
  }));
  const body = { conversationId, anchorGuid: "latest", payload: { suggestions: [], event: null,
    recipeVersion: 1, selectedModel: "opus", servedModel: "opus", fallback: false, noReply: true } };
  const { path, ...init } = post("/comma/ingest/suggestions", body);
  expect((await t.fetch(path, { ...init, headers: {} })).status).toBe(401);
  expect((await t.fetch(path, init)).status).toBe(200);
  expect((await t.fetch(path, init)).status).toBe(200);
  const rows = await t.run((ctx) => ctx.db.query("comma_suggestions").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject(body);
  expect((await t.fetch(path, { ...init, body: JSON.stringify({ ...body, payload: { ...body.payload, selectedModel: "invalid" } }) })).status).toBe(400);
});
