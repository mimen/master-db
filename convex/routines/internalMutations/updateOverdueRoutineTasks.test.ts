import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { internal } from "../../_generated/api";
import schema from "../../schema";
import { normalizeModules } from "../../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../../**/*.*s"), import.meta.url);
const DAY = 86400000;

test("an overdue routine task whose Todoist item is checked is completed, not missed", async () => {
  const t = convexTest(schema, modules);
  const completedAt = "2026-11-20T09:30:00.000Z";
  const now = Date.now();
  const [doneId, missedId] = await t.run(async (ctx) => {
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
    const task = (todoistTaskId: string) =>
      ctx.db.insert("routineTasks", {
        routineId,
        todoistTaskId,
        readyDate: now - 4 * DAY,
        dueDate: now - 3 * DAY,
        status: "pending",
        createdAt: 0,
        updatedAt: 0,
      });
    const item = (todoist_id: string, checked: boolean) =>
      ctx.db.insert("todoist_items", {
        todoist_id,
        content: "Stretch",
        child_order: 0,
        priority: 1,
        labels: ["routine"],
        comment_count: 0,
        checked,
        is_deleted: false,
        added_at: completedAt,
        completed_at: checked ? completedAt : undefined,
        user_id: "u1",
        sync_version: 1,
      });
    await item("done", true);
    await item("open", false);
    return [await task("done"), await task("open")];
  });

  const result = await t.mutation(
    internal.routines.internalMutations.updateOverdueRoutineTasks.updateOverdueRoutineTasks,
    {},
  );

  expect(result.missedTaskIds).toEqual(["open"]);
  expect(result.missedCount).toBe(1);
  expect(await t.run((ctx) => ctx.db.get(doneId))).toMatchObject({
    status: "completed",
    completedDate: Date.parse(completedAt),
  });
  expect((await t.run((ctx) => ctx.db.get(missedId)))?.status).toBe("missed");
});
