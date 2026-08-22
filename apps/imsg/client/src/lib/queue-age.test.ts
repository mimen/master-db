import { describe, expect, test } from "bun:test";

import { queueAgeLabel } from "./queue-age";

const NOW = Date.parse("2026-08-21T12:00:00Z");

describe("queueAgeLabel", () => {
  test("null timestamp", () => {
    expect(queueAgeLabel(null, NOW)).toBe("no open conversations");
  });

  test("hours under a day", () => {
    expect(queueAgeLabel(NOW - 3_600_000, NOW)).toBe("oldest 1h");
    expect(queueAgeLabel(NOW - 10 * 3_600_000, NOW)).toBe("oldest 10h");
  });

  test("days under the cap", () => {
    expect(queueAgeLabel(NOW - 2 * 86_400_000, NOW)).toBe("oldest 2d");
    expect(queueAgeLabel(NOW - 30 * 86_400_000, NOW)).toBe("oldest 30d");
  });

  test("caps extreme age", () => {
    expect(queueAgeLabel(NOW - 937 * 86_400_000, NOW)).toBe("oldest 30d+");
  });
});
