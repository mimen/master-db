import { describe, expect, mock, test } from "bun:test";

let reduceMotion = false;
mock.module("react-native-reanimated", () => ({ useReducedMotion: () => reduceMotion }));

const { HOVER_TRANSITION, Springs, useSpring } = await import("./springs");

/** Steps a unit step response of the damped spring and returns its peak, as a fraction of the target. */
function peak({ stiffness, damping, mass }: { stiffness: number; damping: number; mass: number }): number {
  let x = -1;
  let v = 0;
  let max = 0;
  const dt = 1e-5;
  for (let t = 0; t < 2; t += dt) {
    v += ((-stiffness * x - damping * v) / mass) * dt;
    x += v * dt;
    max = Math.max(max, 1 + x);
  }
  return max;
}

describe("spring presets", () => {
  test("match the design tokens (round4/tokens.json motion.springs)", () => {
    const round = (c: { stiffness: number; damping: number; mass: number }) => ({
      stiffness: Math.round(c.stiffness * 10) / 10,
      damping: Math.round(c.damping * 100) / 100,
      mass: c.mass,
    });
    expect(round(Springs.snappy)).toEqual({ stiffness: 566.4, damping: 42.84, mass: 1 });
    expect(round(Springs.smooth)).toEqual({ stiffness: 189.9, damping: 25.35, mass: 1 });
    expect(round(Springs.lazy)).toEqual({ stiffness: 90.6, damping: 18.28, mass: 1 });
  });

  test("never overshoot past 100.2%", () => {
    for (const config of Object.values(Springs)) {
      const top = peak(config);
      expect(top).toBeGreaterThan(1);
      expect(top).toBeLessThanOrEqual(1.002);
    }
  });

  test("become instant under Reduce Motion", () => {
    reduceMotion = true;
    expect(useSpring("lazy")).toEqual({ duration: 0 });
    reduceMotion = false;
    expect(useSpring("lazy")).toBe(Springs.lazy);
  });

  test("hover transitions only color and opacity, at 120ms", () => {
    expect(HOVER_TRANSITION).toBe(
      "background-color 120ms cubic-bezier(0.2,0,0,1), color 120ms cubic-bezier(0.2,0,0,1), opacity 120ms cubic-bezier(0.2,0,0,1)",
    );
  });
});
