import { describe, expect, test } from "bun:test";
import {
  formatScheduledWhen,
  parseScheduleInput,
  scheduledStatusLabel,
  scheduleInputParts,
} from "./scheduled";

describe("formatScheduledWhen", () => {
  const now = new Date(2026, 6, 18, 9, 0, 0); // Sat Jul 18 2026, 9:00 AM

  test("same calendar day renders as Today", () => {
    const later = new Date(2026, 6, 18, 15, 30, 0).getTime();
    expect(formatScheduledWhen(later, now)).toStartWith("Today, ");
  });

  test("next calendar day renders as Tomorrow", () => {
    const tomorrow = new Date(2026, 6, 19, 9, 0, 0).getTime();
    expect(formatScheduledWhen(tomorrow, now)).toStartWith("Tomorrow, ");
  });

  test("further-out dates render as month/day", () => {
    const later = new Date(2026, 6, 25, 9, 0, 0).getTime();
    expect(formatScheduledWhen(later, now)).toStartWith("Jul 25, ");
  });

  test("day boundary is by calendar date, not 24h distance", () => {
    // 11pm tonight vs 1am tomorrow are ~2h apart but different calendar days.
    const lateTonight = new Date(2026, 6, 18, 23, 0, 0).getTime();
    const earlyTomorrow = new Date(2026, 6, 19, 1, 0, 0).getTime();
    expect(formatScheduledWhen(lateTonight, now)).toStartWith("Today, ");
    expect(formatScheduledWhen(earlyTomorrow, now)).toStartWith("Tomorrow, ");
  });
});


test("formats normalized BlueBubbles schedule statuses", () => {
  expect(scheduledStatusLabel("pending")).toBe("Scheduled");
  expect(scheduledStatusLabel("interrupted")).toBe("Interrupted");
  expect(scheduledStatusLabel("expired")).toBe("Expired");
});


describe("custom schedule date and time", () => {
  test("round-trips local date/time fields", () => {
    const value = new Date(2030, 4, 6, 14, 35, 0, 0).getTime();
    expect(scheduleInputParts(value)).toEqual({ date: "2030-05-06", time: "14:35" });
    expect(parseScheduleInput("2030-05-06", "14:35", value - 1)).toEqual({ ok: true, value });
  });

  test("rejects malformed and past values", () => {
    expect(parseScheduleInput("May 6", "2pm", 0)).toEqual({
      ok: false,
      error: "Use YYYY-MM-DD and HH:MM",
    });
    expect(parseScheduleInput("2026-02-31", "10:00", 0)).toEqual({
      ok: false,
      error: "Choose a valid date and time",
    });
    expect(parseScheduleInput("2020-01-01", "10:00", Date.now())).toEqual({
      ok: false,
      error: "Choose a future date and time",
    });
  });
});