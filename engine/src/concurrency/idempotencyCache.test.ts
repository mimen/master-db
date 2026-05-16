import { describe, expect, test, vi } from "vitest";

import { createIdempotencyCache } from "./idempotencyCache";

describe("idempotencyCache", () => {
  test("returns cached value within TTL", async () => {
    vi.useFakeTimers();
    const cache = createIdempotencyCache({ ttlMs: 1000 });
    const fn = vi.fn().mockResolvedValue({ value: 1 });
    const r1 = await cache.runOnce({ key: "k", entity_ref: "e", route: "r" }, fn);
    const r2 = await cache.runOnce({ key: "k", entity_ref: "e", route: "r" }, fn);
    expect(r1).toEqual({ value: 1 });
    expect(r2).toEqual({ value: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test("re-runs after TTL expires", async () => {
    vi.useFakeTimers();
    const cache = createIdempotencyCache({ ttlMs: 100 });
    const fn = vi.fn().mockImplementation(async () => ({ n: Math.random() }));
    await cache.runOnce({ key: "k", entity_ref: "e", route: "r" }, fn);
    vi.advanceTimersByTime(200);
    await cache.runOnce({ key: "k", entity_ref: "e", route: "r" }, fn);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  test("skips cache when key is undefined", async () => {
    const cache = createIdempotencyCache({ ttlMs: 1000 });
    const fn = vi.fn().mockResolvedValue("x");
    await cache.runOnce({ key: undefined, entity_ref: "e", route: "r" }, fn);
    await cache.runOnce({ key: undefined, entity_ref: "e", route: "r" }, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
