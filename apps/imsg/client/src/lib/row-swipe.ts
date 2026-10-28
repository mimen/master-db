/** Distance at which a phone row swipe arms its action. */
export const SWIPE_THRESHOLD = 110;
/** The most a swipe travels past the threshold, however far the finger goes. */
export const SWIPE_OVERSHOOT_CAP = 56;

/**
 * Row offset for a finger offset: 1:1 up to the threshold, then resistance
 * that grows with distance and never passes the cap.
 */
// No default parameters: a worklet's closure is unpacked in its body, after defaults evaluate,
// so a default that names a module constant throws ReferenceError on the UI thread.
export function rubberBand(dx: number, threshold?: number, cap?: number): number {
  "worklet";
  threshold ??= SWIPE_THRESHOLD;
  cap ??= SWIPE_OVERSHOOT_CAP;
  const distance = Math.abs(dx);
  if (distance <= threshold) return dx;
  const past = distance - threshold;
  return Math.sign(dx) * (threshold + cap * (1 - 1 / ((past * 0.55) / cap + 1)));
}
