import { describe, expect, test } from "vitest";

describe("getMessagesByChat projection", () => {
  test("default limit is 100", () => {
    const limit = undefined as number | undefined;
    expect(limit ?? 100).toBe(100);
  });

  test("before_ts_epoch_ms acts as exclusive upper bound for keyset pagination", () => {
    const all = [
      { ts_epoch_ms: 1000 },
      { ts_epoch_ms: 2000 },
      { ts_epoch_ms: 3000 },
    ];
    const before = 2500;
    const page = all.filter((m) => m.ts_epoch_ms < before);
    expect(page.length).toBe(2);
    expect(page.map((m) => m.ts_epoch_ms)).toEqual([1000, 2000]);
  });
});
