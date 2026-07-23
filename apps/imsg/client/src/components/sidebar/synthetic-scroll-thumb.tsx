import { Animated, StyleSheet } from "react-native";

import type { SyntheticThumbState } from "./use-synthetic-scroll-metrics";

/** The synthetic scrollbar thumb overlay — geometry comes entirely from
 * useSyntheticScrollMetrics; renders nothing when there's nothing to scroll. */
export function SyntheticScrollThumb({ state }: { state: SyntheticThumbState }): React.JSX.Element | null {
  if (!state.visible) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.thumb,
        { top: state.top, height: state.height, transform: [{ translateY: state.translateY }] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  thumb: {
    position: "absolute",
    right: 2,
    width: 6,
    borderRadius: 3,
    backgroundColor: "rgba(140,140,150,0.5)",
    zIndex: 5,
  },
});
