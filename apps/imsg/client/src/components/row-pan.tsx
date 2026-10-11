import type { ReactNode } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { ReduceMotion, runOnJS, withSpring, type SharedValue } from "react-native-reanimated";

import { Springs } from "@/constants/springs";
import { rubberBand, SWIPE_THRESHOLD } from "@/lib/row-swipe";

/**
 * Phone swipe: left settles, right toggles unread. The row follows the finger 1:1,
 * rubber-bands past the threshold, and commits on release.
 */
export function RowPan({
  offset,
  dragging,
  settleOffered,
  onSettle,
  onToggleRead,
  children,
}: {
  offset: SharedValue<number>;
  dragging: SharedValue<boolean>;
  settleOffered: boolean;
  onSettle: () => void;
  onToggleRead: () => void;
  children: ReactNode;
}): React.JSX.Element {
  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onBegin(() => {
      dragging.value = true;
    })
    .onUpdate((event) => {
      const dx = !settleOffered && event.translationX < 0 ? 0 : event.translationX;
      offset.value = rubberBand(dx);
    })
    .onFinalize(() => {
      dragging.value = false;
      const committed = Math.abs(offset.value) >= SWIPE_THRESHOLD;
      if (committed && offset.value < 0 && settleOffered) runOnJS(onSettle)();
      else if (committed && offset.value > 0) runOnJS(onToggleRead)();
      // An armed release slides home on smooth; an unarmed one springs back on snappy.
      offset.value = withSpring(0, { ...(committed ? Springs.smooth : Springs.snappy), reduceMotion: ReduceMotion.System });
    });
  return <GestureDetector gesture={pan}>{children}</GestureDetector>;
}
