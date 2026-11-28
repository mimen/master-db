import { createHmac } from "node:crypto";

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import { markRoutineTaskCompleted } from "../routines/internalMutations/markRoutineTaskCompleted";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { upsertItem } from "./internalMutations/upsertItem";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const SECRET = "webhook-secret";
const TRIGGERED_AT = "2026-11-20T09:30:00.000Z";

const previousSecret = process.env.TODOIST_WEBHOOK_SECRET;
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (previousSecret === undefined) delete process.env.TODOIST_WEBHOOK_SECRET;
  else process.env.TODOIST_WEBHOOK_SECRET = previousSecret;
});

const completedEvent = JSON.stringify({
  event_name: "item:completed",
  user_id: "u1",
  version: "10",
  triggered_at: TRIGGERED_AT,
  initiator: { id: "u1", email: "u1@example.com", full_name: "U One", image_id: null, is_premium: true },
  event_data: {
    id: "task-1",
    content: "Stretch",
    labels: ["routine"],
    checked: true,
    updated_at: TRIGGERED_AT,
  },
});

// Throw once from a Convex function's handler; convex-test reads `_handler` on every call.
function failOnce(fn: unknown) {
  return vi
    .spyOn(fn as { _handler: () => Promise<unknown> }, "_handler")
    .mockRejectedValueOnce(new Error("transient"));
}

async function setup() {
  process.env.TODOIST_WEBHOOK_SECRET = SECRET;
  vi.useFakeTimers(); // keep the scheduled metadata extraction from running after the test
  const t = convexTest(schema, modules);
  const routineTaskId = await t.run(async (ctx) => {
    const routineId = await ctx.db.insert("routines", {
      name: "Stretch",
      frequency: "Daily",
      duration: "15min",
      todoistLabels: [],
      priority: 1,
      defer: false,
      completionRateOverall: null,
      completionRateMonth: null,
      createdAt: 0,
      updatedAt: 0,
    });
    return ctx.db.insert("routineTasks", {
      routineId,
      todoistTaskId: "task-1",
      readyDate: 0,
      dueDate: Date.parse(TRIGGERED_AT) + 86400000,
      status: "pending",
      createdAt: 0,
      updatedAt: 0,
    });
  });
  const post = () =>
    t.fetch("/todoist/webhook", {
      method: "POST",
      headers: {
        "X-Todoist-Hmac-SHA256": createHmac("sha256", SECRET).update(completedEvent).digest("base64"),
        "X-Todoist-Delivery-ID": "delivery-1",
      },
      body: completedEvent,
    });
  return { t, post, routineTaskId };
}

describe("todoist webhook retries", () => {
  test("a failed upsert answers 5xx and the retried delivery is processed", async () => {
    const { t, post, routineTaskId } = await setup();
    failOnce(upsertItem);

    expect((await post()).status).toBe(500);
    expect((await post()).status).toBe(200);

    const item = await t.run((ctx) =>
      ctx.db.query("todoist_items").withIndex("by_todoist_id", (q) => q.eq("todoist_id", "task-1")).first(),
    );
    expect(item?.checked).toBe(true);
    const routineTask = await t.run((ctx) => ctx.db.get(routineTaskId));
    expect(routineTask).toMatchObject({ status: "completed", completedDate: Date.parse(TRIGGERED_AT) });
    const statuses = await t.run(async (ctx) =>
      (await ctx.db.query("todoist_webhook_events").collect()).map((e) => e.status),
    );
    expect(statuses).toEqual(["failed", "success"]);
  });

  test("a failed routine update fails the event so the retry completes the routine task", async () => {
    const { t, post, routineTaskId } = await setup();
    failOnce(markRoutineTaskCompleted);

    expect((await post()).status).toBe(500);
    expect((await t.run((ctx) => ctx.db.get(routineTaskId)))?.status).toBe("pending");

    expect((await post()).status).toBe(200);
    expect(await t.run((ctx) => ctx.db.get(routineTaskId))).toMatchObject({
      status: "completed",
      completedDate: Date.parse(TRIGGERED_AT),
    });
  });

  test("a successfully processed delivery is not processed again", async () => {
    const { t, post } = await setup();
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    expect(await t.run((ctx) => ctx.db.query("todoist_webhook_events").collect())).toHaveLength(1);
  });
});
