import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "../../_generated/api";
import { ALLOWED_EMAIL } from "../../_lib/authed";
import schema from "../../schema";
import { normalizeModules } from "../../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../../**/*.*s"), import.meta.url);

test("a fixed-timezone due lands on the caller's calendar day, not its UTC day", async () => {
  // 8pm Pacific on Nov 1. Todoist sends a due with a fixed timezone as a UTC instant.
  const offset = -480;
  const now = Date.UTC(2026, 10, 2, 4);
  const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL });
  const item = (todoist_id: string, date: string, child_order: number) => t.run((ctx) => ctx.db.insert("todoist_items", {
    todoist_id, content: todoist_id, child_order, priority: 1, labels: [], comment_count: 0,
    checked: false, is_deleted: false, added_at: "2026-01-01T00:00:00Z", user_id: "u1", sync_version: 1,
    due: { date, is_recurring: false, string: date, timezone: "America/Los_Angeles" },
  }));
  await item("tonight", "2026-11-02T03:00:00Z", 0);
  await item("last-night", "2026-11-01T03:00:00.000000Z", 1);
  await item("next-sunday", "2026-11-09T03:00:00Z", 2);

  const args = { timezoneOffsetMinutes: offset, now };
  const ids = (rows: { todoist_id: string }[]) => rows.map((row) => row.todoist_id);

  expect(ids(await t.query(api.todoist.queries.getDueTodayItems.getDueTodayItems, args))).toEqual(["tonight"]);
  expect(ids(await t.query(api.todoist.queries.getOverdueItems.getOverdueItems, args))).toEqual(["last-night"]);
  expect(ids(await t.query(api.todoist.queries.getDueNext7DaysItems.getDueNext7DaysItems, args))).toEqual(["next-sunday"]);
  expect(await t.query(api.todoist.computed.queries.getAllListCounts.getAllListCounts, args)).toMatchObject({
    "list:time:today": 1, "list:time:overdue": 1, "list:time:upcoming": 1, "list:time:future": 0,
  });
});
