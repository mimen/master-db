// "Muted Editorial" palette, saturation nudged up: 20 evenly-spaced hues drawn
// as a soft diagonal gradient — richer than a rainbow, still grown-up.
const PALETTE = { s1: 54, l1: 58, shift: 30, s2: 58, l2: 47 } as const;

// Initials take whichever of white or ink contrasts more with the gradient's midpoint.
// Measured per slot: the worst pick is 4.36:1, where white alone fell to 2.04:1.
const INITIALS_INK = "#141418";

function luminance(hue: number, s: number, l: number): number {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

/** Deterministic per-contact gradient. A 20-slot palette keyed off the address. */
export function avatarColor(key: string): { start: string; end: string; fg: string } {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hue = (h % 20) * 18;
  const hue2 = (hue + PALETTE.shift) % 360;
  const mid = (luminance(hue, PALETTE.s1, PALETTE.l1) + luminance(hue2, PALETTE.s2, PALETTE.l2)) / 2;
  const onWhite = 1.05 / (mid + 0.05);
  const onInk = (mid + 0.05) / (0.0068 + 0.05);
  return {
    start: `hsl(${hue}, ${PALETTE.s1}%, ${PALETTE.l1}%)`,
    end: `hsl(${hue2}, ${PALETTE.s2}%, ${PALETTE.l2}%)`,
    fg: onWhite >= onInk ? "#ffffff" : INITIALS_INK,
  };
}
