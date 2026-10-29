import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "../../_generated/api";
import { ALLOWED_EMAIL } from "../../_lib/authed";
import schema from "../../schema";
import { normalizeModules } from "../../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../../**/*.*s"), import.meta.url);

test("a floating local due time stays on the caller's calendar day", async () => {
  // Noon in Tokyo. The strings are Todoist's floating local datetimes (no zone).
  const offset = 540;
  const now = Date.UTC(2026, 9, 28, 3);
  const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL });
  const item = (todoist_id: string, date: string, child_order: number) => t.run((ctx) => ctx.db.insert("todoist_items", {
    todoist_id, content: todoist_id, child_order, priority: 1, labels: [], comment_count: 0,
    checked: false, is_deleted: false, added_at: "2026-01-01T00:00:00Z", user_id: "u1", sync_version: 1,
    due: { date, is_recurring: false, string: date },
  }));
  await item("all-day", "2026-10-28", 0);
  await item("tonight", "2026-10-28T23:00:00", 1);
  await item("last-night", "2026-10-27T23:00:00", 2);

  const today = api.todoist.queries.getDueTodayItems.getDueTodayItems;
  const counts = api.todoist.computed.queries.getAllListCounts.getAllListCounts;
  const ids = (await t.query(today, { timezoneOffsetMinutes: offset, now })).map((row: { todoist_id: string }) => row.todoist_id);

  expect(ids).toEqual(["all-day", "tonight"]);
  expect(await t.query(counts, { timezoneOffsetMinutes: offset, now })).toMatchObject({ "list:time:today": 2 });
});
