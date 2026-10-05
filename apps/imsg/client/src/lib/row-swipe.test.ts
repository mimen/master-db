import { expect, test } from "bun:test";

import { rubberBand, SWIPE_OVERSHOOT_CAP, SWIPE_THRESHOLD } from "./row-swipe";

test("a swipe tracks the finger 1:1 up to the threshold, in both directions", () => {
  expect(rubberBand(40)).toBe(40);
  expect(rubberBand(-SWIPE_THRESHOLD)).toBe(-SWIPE_THRESHOLD);
});

test("past the threshold the row resists, keeps moving, and never passes the cap", () => {
  const a = rubberBand(SWIPE_THRESHOLD + 40);
  const b = rubberBand(SWIPE_THRESHOLD + 200);
  expect(a).toBeGreaterThan(SWIPE_THRESHOLD);
  expect(a).toBeLessThan(SWIPE_THRESHOLD + 40);
  expect(b).toBeGreaterThan(a);
  expect(rubberBand(10_000)).toBeLessThan(SWIPE_THRESHOLD + SWIPE_OVERSHOOT_CAP);
  expect(rubberBand(-(SWIPE_THRESHOLD + 200))).toBe(-b);
});
