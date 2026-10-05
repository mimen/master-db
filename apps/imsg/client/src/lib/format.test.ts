import { describe, expect, test } from "bun:test";

import { formatAge } from "./format";

const NOW = Date.UTC(2026, 9, 4, 12);
const MIN = 60_000;

describe("formatAge", () => {
  test("steps from minutes to hours, days, weeks and years", () => {
    const ages = [0.5, 14, 59, 60, 23 * 60 + 59, 24 * 60, 13 * 24 * 60, 14 * 24 * 60, 400 * 24 * 60];
    expect(ages.map((m) => formatAge(NOW - m * MIN, NOW))).toEqual(["now", "14m", "59m", "1h", "23h", "1d", "13d", "2w", "1y"]);
  });

  test("a future timestamp from clock skew reads now", () => {
    expect(formatAge(NOW + 5 * MIN, NOW)).toBe("now");
  });
});
