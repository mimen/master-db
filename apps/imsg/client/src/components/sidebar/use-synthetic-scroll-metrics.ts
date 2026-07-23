import { useRef, useState } from "react";
import { Animated, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

/** Height of the fixed frosted-glass sidebar bar. Styled, not measured —
 * runtime measurement once fed the keyboard adapter a stale pre-measure
 * value (up-pin landed under the bar). One source of truth for both panes. */
export const SIDEBAR_CHROME_HEIGHT = 58;

export interface SyntheticThumbState {
  readonly visible: boolean;
  /** Track starts just below the fixed chrome. */
  readonly top: number;
  readonly height: number;
  readonly translateY: Animated.AnimatedInterpolation<number>;
}

export interface SyntheticScrollMetrics {
  readonly thumb: SyntheticThumbState;
  /** Latest viewport height (ref-backed; safe inside stable closures). */
  viewportHeight(): number;
  onViewportHeight(height: number): void;
  /** For plain FlatLists whose onContentSizeChange IS reliable (FlashList's
   * isn't — its dimensions arrive via scroll events instead). */
  onContentHeight(height: number): void;
  onScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void;
}

/**
 * Passive synthetic-scrollbar geometry, shared by both sidebars. The native
 * indicator is hidden so it doesn't run behind the glass top bar; this thumb
 * starts just below the bar while content still scrolls under it. Driven by
 * an Animated value so scrolling doesn't re-render. Purely observational —
 * this hook NEVER scrolls anything.
 *
 * FlashList virtualizes, so full content height isn't known until the list
 * scrolls once; callers pass an estimate so the thumb is sized correctly at
 * rest (dimensions from scroll events replace it as they arrive — FlashList's
 * onContentSizeChange is unreliable, and stateful loops on it are forbidden).
 */
export function useSyntheticScrollMetrics(args: {
  readonly chromeHeight: number;
  readonly estimatedContentHeight: number;
}): SyntheticScrollMetrics {
  const { chromeHeight, estimatedContentHeight } = args;
  const [contentH, setContentH] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const contentHRef = useRef(0);
  const viewportHRef = useRef(0);
  const scrollYAnim = useRef(new Animated.Value(0)).current;

  // Animated.event drives the thumb without re-rendering; the listener only
  // re-renders when a DIMENSION actually changes (guarded via refs).
  const onScrollRef = useRef(
    Animated.event([{ nativeEvent: { contentOffset: { y: scrollYAnim } } }], {
      useNativeDriver: false,
      listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const ne = event.nativeEvent;
        if (Math.abs(ne.contentSize.height - contentHRef.current) > 1) {
          contentHRef.current = ne.contentSize.height;
          setContentH(ne.contentSize.height);
        }
        if (Math.abs(ne.layoutMeasurement.height - viewportHRef.current) > 1) {
          viewportHRef.current = ne.layoutMeasurement.height;
          setViewportH(ne.layoutMeasurement.height);
        }
      },
    }),
  );

  const effContentH = contentH > 0 ? contentH : estimatedContentHeight;
  const trackH = Math.max(0, viewportH - chromeHeight - 6);
  const visible = viewportH > 0 && effContentH > viewportH + 4;
  const height = visible ? Math.max(36, (trackH * viewportH) / effContentH) : 0;
  const translateY = scrollYAnim.interpolate({
    inputRange: [0, Math.max(1, effContentH - viewportH)],
    outputRange: [0, Math.max(0, trackH - height)],
    extrapolate: "clamp",
  });

  return {
    thumb: { visible, top: chromeHeight, height, translateY },
    viewportHeight: () => viewportHRef.current,
    onViewportHeight(h) {
      viewportHRef.current = h;
      setViewportH(h);
    },
    onContentHeight(h) {
      contentHRef.current = h;
      setContentH(h);
    },
    onScroll: onScrollRef.current,
  };
}
