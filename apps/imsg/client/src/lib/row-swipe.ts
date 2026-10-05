/** Distance at which a phone row swipe arms its action. */
export const SWIPE_THRESHOLD = 110;
/** The most a swipe travels past the threshold, however far the finger goes. */
export const SWIPE_OVERSHOOT_CAP = 56;

/**
 * Row offset for a finger offset: 1:1 up to the threshold, then resistance
 * that grows with distance and never passes the cap.
 */
export function rubberBand(dx: number, threshold = SWIPE_THRESHOLD, cap = SWIPE_OVERSHOOT_CAP): number {
  "worklet";
  const distance = Math.abs(dx);
  if (distance <= threshold) return dx;
  const past = distance - threshold;
  return Math.sign(dx) * (threshold + cap * (1 - 1 / ((past * 0.55) / cap + 1)));
}
