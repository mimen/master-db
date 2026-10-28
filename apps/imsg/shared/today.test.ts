import { describe, expect, test } from "bun:test";
import { todayCandidateState, todayWindow, type DayKey } from "./today";

const HOUR = 3_600_000;
const win = (day: string, start: number) => ({ day: day as DayKey, start });
const flags = (over: Partial<{ unresponded: boolean; waiting: boolean }>) => ({
  unresponded: false, waiting: false, unread: false, mutedUnresponded: false, pinned: false, ...over,
});

describe("todayWindow", () => {
  test("names the LA day and its midnight in daylight time", () => {
    expect(todayWindow(Date.parse("2026-10-27T15:00:00Z"))).toEqual(win("2026-10-27", Date.parse("2026-10-27T07:00:00Z")));
  });

  test("names the LA day and its midnight in standard time", () => {
    expect(todayWindow(Date.parse("2026-12-01T20:00:00Z"))).toEqual(win("2026-12-01", Date.parse("2026-12-01T08:00:00Z")));
  });

  test("rolls at LA midnight, not UTC midnight", () => {
    const midnight = Date.parse("2026-10-28T07:00:00Z");
    expect(todayWindow(midnight - 60_000).day as string).toBe("2026-10-27");
    expect(todayWindow(midnight).day as string).toBe("2026-10-28");
    expect(todayWindow(midnight).start).toBe(midnight);
  });

  test("the spring-forward day is 23 hours long", () => {
    const day = todayWindow(Date.parse("2026-03-08T20:00:00Z"));
    expect(day).toEqual(win("2026-03-08", Date.parse("2026-03-08T08:00:00Z")));
    expect(todayWindow(day.start + 23 * HOUR)).toEqual(win("2026-03-09", day.start + 23 * HOUR));
  });

  test("the fall-back day is 25 hours long", () => {
    const day = todayWindow(Date.parse("2026-11-01T20:00:00Z"));
    expect(day).toEqual(win("2026-11-01", Date.parse("2026-11-01T07:00:00Z")));
    expect(todayWindow(day.start + 25 * HOUR - 1).day as string).toBe("2026-11-01");
    expect(todayWindow(day.start + 25 * HOUR)).toEqual(win("2026-11-02", day.start + 25 * HOUR));
  });
});

describe("todayCandidateState", () => {
  const now = Date.parse("2026-10-27T15:00:00Z");
  const base = { known: true, isSpam: false, lastMessageAt: now - HOUR };

  test("Needs you counts at any age", () => {
    expect(todayCandidateState({ ...base, flags: flags({ unresponded: true }), lastMessageAt: now - 90 * 86_400_000 }, now)).toBe("needsYou");
  });

  test("Waiting counts only under thirty days", () => {
    const waiting = { ...base, flags: flags({ waiting: true }) };
    expect(todayCandidateState({ ...waiting, lastMessageAt: now - 30 * 86_400_000 + 1 }, now)).toBe("waiting");
    expect(todayCandidateState({ ...waiting, lastMessageAt: now - 30 * 86_400_000 }, now)).toBeNull();
  });

  test("spam and unknown senders never enter", () => {
    expect(todayCandidateState({ ...base, isSpam: true, flags: flags({ unresponded: true }) }, now)).toBeNull();
    expect(todayCandidateState({ ...base, known: false, flags: flags({ unresponded: true }) }, now)).toBeNull();
  });

  test("a conversation held only by an agent chat is not a candidate", () => {
    expect(todayCandidateState({ ...base, flags: flags({}) }, now)).toBeNull();
  });
});
