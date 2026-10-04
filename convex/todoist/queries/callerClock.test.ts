import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";

import { api } from "../../_generated/api";
import { ALLOWED_EMAIL } from "../../_lib/authed";
import schema from "../../schema";
import { normalizeModules } from "../../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../../**/*.*s"), import.meta.url);
afterEach(() => vi.restoreAllMocks());

const MAY_1 = Date.UTC(2026, 4, 1, 12);
const MAY_2 = Date.UTC(2026, 4, 2, 12);

test("due lists and counts judge the day by the caller's now, and fall back to the server clock", async () => {
  const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL });
  await t.run((ctx) => ctx.db.insert("todoist_items", {
    todoist_id: "may1", content: "Due May 1", child_order: 0, priority: 1, labels: [], comment_count: 0,
    checked: false, is_deleted: false, added_at: "2026-01-01T00:00:00Z", user_id: "u1", sync_version: 1,
    due: { date: "2026-05-01", is_recurring: false, string: "May 1" },
  }));
  const ids = (rows: Array<{ todoist_id: string }>) => rows.map((r) => r.todoist_id);
  const today = api.todoist.queries.getDueTodayItems.getDueTodayItems;
  const overdue = api.todoist.queries.getOverdueItems.getOverdueItems;
  const counts = api.todoist.computed.queries.getAllListCounts.getAllListCounts;

  expect(ids(await t.query(today, { now: MAY_1 }))).toEqual(["may1"]);
  expect(ids(await t.query(overdue, { now: MAY_1 }))).toEqual([]);
  expect(ids(await t.query(today, { now: MAY_2 }))).toEqual([]);
  expect(ids(await t.query(overdue, { now: MAY_2 }))).toEqual(["may1"]);
  expect(await t.query(counts, { now: MAY_2 })).toMatchObject({ "list:time:today": 0, "list:time:overdue": 1 });

  vi.spyOn(Date, "now").mockReturnValue(MAY_1);
  expect(ids(await t.query(today, {}))).toEqual(["may1"]);
});
