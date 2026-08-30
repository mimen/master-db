import { describe, expect, test } from "bun:test";
import type { EventSuggestion } from "@shared/types";
import { calendarTemplateUrl, eventShelfLabel, parseEventStart } from "./calendar-link";

const event: EventSuggestion = {
  title: "Production call with Meghan",
  start: "2026-08-30T18:00",
  durationMinutes: 60,
  location: null,
};

describe("calendarTemplateUrl", () => {
  test("builds a prefilled template with a floating local range", () => {
    const url = calendarTemplateUrl(event);
    expect(url).toContain("https://calendar.google.com/calendar/render?");
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("text=Production+call+with+Meghan");
    expect(url).toContain("dates=20260830T180000%2F20260830T190000");
    expect(url).not.toContain("location=");
  });

  test("duration sets the end and location carries through", () => {
    const url = calendarTemplateUrl({ ...event, durationMinutes: 90, location: "the studio" });
    expect(url).toContain("dates=20260830T180000%2F20260830T193000");
    expect(url).toContain("location=the+studio");
  });

  test("an end past midnight rolls the date", () => {
    const url = calendarTemplateUrl({ ...event, start: "2026-08-30T23:30" });
    expect(url).toContain("dates=20260830T233000%2F20260831T003000");
  });

  test("a malformed start yields no link", () => {
    expect(calendarTemplateUrl({ ...event, start: "sunday at 6" })).toBeNull();
    expect(parseEventStart("2026-8-30T18:00")).toBeNull();
  });
});

describe("eventShelfLabel", () => {
  test("renders a short local label", () => {
    expect(eventShelfLabel(event)).toBe("Sun, Aug 30 at 6:00 PM");
  });
});
