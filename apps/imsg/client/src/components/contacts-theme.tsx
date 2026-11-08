import { useEffect } from "react";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";

import { Springs } from "@/constants/springs";
import { headerFace } from "@/lib/header-font";

/** Bricolage on headers only; system everywhere else. */
export const HEADER_FONT = headerFace.fontFamily;

/** Enters from 14px below on the smooth spring each time `key` changes; instant under Reduce Motion. */
export function EnterFromBelow({ motionKey, children, style }: {
  readonly motionKey: string;
  readonly children: React.ReactNode;
  readonly style?: object;
}): React.JSX.Element {
  const reduce = useReducedMotion();
  const y = useSharedValue(reduce ? 0 : 14);
  const opacity = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) {
      y.value = 0;
      opacity.value = 1;
      return;
    }
    y.value = 14;
    opacity.value = 0;
    y.value = withSpring(0, Springs.smooth);
    opacity.value = withSpring(1, Springs.smooth);
  }, [motionKey, reduce, y, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: y.value }] }));
  return <Animated.View style={[{ flex: 1 }, style, animated]}>{children}</Animated.View>;
}
