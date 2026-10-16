import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "../../_generated/api";
import { ALLOWED_EMAIL } from "../../_lib/authed";
import schema from "../../schema";
import { normalizeModules } from "../../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../../**/*.*s"), import.meta.url);

// Each caller's local date differs from the UTC date at `now`, so a server that
// judges "today" by its own clock disagrees with the caller in one case or the other.
const cases = [
  { name: "Pacific evening", offset: -420, now: Date.UTC(2026, 9, 16, 1), due: "2026-10-15", overdue: false },
  { name: "Tokyo morning", offset: 540, now: Date.UTC(2026, 9, 15, 16), due: "2026-10-15", overdue: true },
];

test.each(cases)("overdue items judge the day in the caller's timezone ($name)", async ({ offset, now, due, overdue }) => {
  const t = convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL });
  await t.run((ctx) => ctx.db.insert("todoist_items", {
    todoist_id: "task", content: "Due Oct 15", child_order: 0, priority: 1, labels: [], comment_count: 0,
    checked: false, is_deleted: false, added_at: "2026-01-01T00:00:00Z", user_id: "u1", sync_version: 1,
    due: { date: due, is_recurring: false, string: "Oct 15" },
  }));

  const items = await t.query(api.todoist.queries.getOverdueItems.getOverdueItems, { timezoneOffsetMinutes: offset, now });
  const counts = await t.query(api.todoist.computed.queries.getAllListCounts.getAllListCounts, { timezoneOffsetMinutes: offset, now });

  expect(items.map((r: { todoist_id: string }) => r.todoist_id)).toEqual(overdue ? ["task"] : []);
  expect(counts["list:time:overdue"]).toBe(overdue ? 1 : 0);
});
