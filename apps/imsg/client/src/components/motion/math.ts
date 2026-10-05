import type { SpringPreset } from "@/constants/springs";

/**
 * Two edges, two springs: the edge facing the direction of travel leads on snappy and the
 * trailing edge follows on lazy, so an indicator stretches toward its target, then contracts.
 */
export function edgeSprings(goingRight: boolean): { left: SpringPreset; right: SpringPreset } {
  return goingRight ? { left: "lazy", right: "snappy" } : { left: "snappy", right: "lazy" };
}

/**
 * The digits of a non-negative integer, keyed by place value from the right, so the ones wheel
 * stays the ones wheel when a digit is added (9 to 10).
 */
export function digitPlaces(value: number): { key: string; digit: number }[] {
  const digits = String(Math.max(0, Math.trunc(value)));
  return [...digits].map((char, index) => ({ key: `d${digits.length - 1 - index}`, digit: Number(char) }));
}
