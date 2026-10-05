import { useReducedMotion, type WithSpringConfig } from "react-native-reanimated";

/** motion-ui's three presets, as motion's `visualDuration` (seconds) and `bounce`. */
const PRESETS = {
  snappy: { visualDuration: 0.22, bounce: 0.1 },
  smooth: { visualDuration: 0.38, bounce: 0.08 },
  lazy: { visualDuration: 0.55, bounce: 0.04 },
} as const;

export type SpringPreset = keyof typeof PRESETS;

/**
 * motion-dom's conversion. Reanimated's own `{ duration, dampingRatio }` mode solves stiffness
 * from a 1.5x settle estimate instead, so it would not move like the web presets.
 */
function physical({ visualDuration, bounce }: { visualDuration: number; bounce: number }) {
  const stiffness = ((2 * Math.PI) / (visualDuration * 1.2)) ** 2;
  return { stiffness, damping: 2 * (1 - bounce) * Math.sqrt(stiffness), mass: 1 };
}

export const Springs = {
  snappy: physical(PRESETS.snappy),
  smooth: physical(PRESETS.smooth),
  lazy: physical(PRESETS.lazy),
} satisfies Record<SpringPreset, WithSpringConfig>;

/** A zero-duration spring: Reanimated jumps straight to the target and still fires the callback. */
export const INSTANT_SPRING: WithSpringConfig = { duration: 0 };

export function springConfig(preset: SpringPreset, reduceMotion: boolean): WithSpringConfig {
  return reduceMotion ? INSTANT_SPRING : Springs[preset];
}

/** The preset's config, or the instant one under Reduce Motion. */
export function useSpring(preset: SpringPreset): WithSpringConfig {
  return springConfig(preset, useReducedMotion());
}

/** Hover and focus feedback on the web: color and opacity only, never position. */
export const HOVER_EASING = "cubic-bezier(0.2,0,0,1)";
export const HOVER_MS = 120;
export const HOVER_TRANSITION = ["background-color", "color", "opacity"]
  .map((property) => `${property} ${HOVER_MS}ms ${HOVER_EASING}`)
  .join(", ");
