import { expect, test } from "bun:test";
import type { ScheduledMessage } from "@shared/types";
import { groupScheduled, scheduledDayTitle } from "./scheduled-groups";

const NOW = new Date(2026, 9, 1, 12, 0); // Thursday Oct 1, noon
const at = (day: number, hour: number): number => new Date(2026, 9, day, hour, 0).getTime();

function item(id: number, sendAt: number, status: ScheduledMessage["status"] = "pending"): ScheduledMessage {
  return { id, chatGuid: `c${id}`, chatName: `Chat ${id}`, text: "hi", sendAt, status, error: null, sentAt: null };
}

test("day titles read relative to now", () => {
  expect(scheduledDayTitle(at(1, 18), NOW)).toBe("Today");
  expect(scheduledDayTitle(at(2, 8), NOW)).toBe("Tomorrow");
  expect(scheduledDayTitle(at(3, 9), NOW)).toBe("Saturday");
  expect(scheduledDayTitle(at(12, 9), NOW)).toBe("Oct 12");
});

test("not-sent items lead, the queue groups by day in time order, sent items trail", () => {
  const groups = groupScheduled([
    item(1, at(3, 17)),
    item(2, at(1, 9), "failed"),
    item(3, at(2, 8)),
    item(4, at(3, 9)),
    item(5, at(1, 7), "complete"),
    item(6, at(1, 8), "expired"),
  ], NOW);
  expect(groups.map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([
    ["Not sent", [6, 2]],
    ["Tomorrow", [3]],
    ["Saturday", [4, 1]],
    ["Sent", [5]],
  ]);
});

test("an empty queue has no sections", () => {
  expect(groupScheduled([], NOW)).toEqual([]);
});
