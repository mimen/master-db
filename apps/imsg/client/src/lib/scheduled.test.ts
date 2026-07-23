import { describe, expect, test } from "bun:test";
import { formatScheduledWhen } from "./scheduled";

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
