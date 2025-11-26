import { describe, expect, it } from "vitest";
import { getTimeOfDayLabel, TimeOfDay } from "./timeOfDay";

describe("getTimeOfDayLabel", () => {
  it("returns 'morning' for Morning", () => {
    expect(getTimeOfDayLabel(TimeOfDay.Morning)).toBe("morning");
  });

  it("returns 'day' for Day", () => {
    expect(getTimeOfDayLabel(TimeOfDay.Day)).toBe("day");
  });

  it("returns 'evening' for Evening", () => {
    expect(getTimeOfDayLabel(TimeOfDay.Evening)).toBe("evening");
  });

  it("returns 'night' for Night", () => {
    expect(getTimeOfDayLabel(TimeOfDay.Night)).toBe("night");
  });
});
