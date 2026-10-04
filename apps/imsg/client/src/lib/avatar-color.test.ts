import { expect, test } from "bun:test";

import { avatarColor } from "./avatar-color";

function hslToRgb(css: string): [number, number, number] {
  const [h, s, l] = css.match(/[\d.]+/g)!.map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: [number, number, number]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const hex = (c: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) as [number, number, number];

test("initials clear 4.3:1 against the gradient midpoint for every palette slot", () => {
  const ratios: number[] = [];
  for (let slot = 0; slot < 20; slot++) {
    const key = Array.from({ length: 400 }, (_, i) => `k${i}`).find((k) => {
      let h = 0;
      for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
      return h % 20 === slot;
    })!;
    const { start, end, fg } = avatarColor(key);
    const mid = (lum(hslToRgb(start)) + lum(hslToRgb(end))) / 2;
    const ink = lum(hex(fg));
    ratios.push((Math.max(mid, ink) + 0.05) / (Math.min(mid, ink) + 0.05));
  }
  expect(Math.min(...ratios)).toBeGreaterThan(4.3);
});
