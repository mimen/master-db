import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { useSpring } from "@/constants/springs";

export interface CollapseProps {
  /** True folds the row to height 0 and opacity 0; false grows it back (Undo). */
  readonly collapsed: boolean;
  readonly children: ReactNode;
  /** Fires once the fold finishes, so the caller can drop the row. */
  readonly onCollapsed?: () => void;
}

/** A leaving row: height and opacity go to 0 on smooth while the rows below close the gap. */
export function Collapse({ collapsed, children, onCollapsed }: CollapseProps): React.JSX.Element {
  const spring = useSpring("smooth");
  const open = useSharedValue(collapsed ? 0 : 1);
  const height = useSharedValue(0);
  const [measured, setMeasured] = useState(false);
  const done = useRef(onCollapsed);
  done.current = onCollapsed;

  useEffect(() => {
    const notify = () => done.current?.();
    open.value = withSpring(collapsed ? 0 : 1, spring, (finished) => {
      "worklet";
      if (finished && collapsed) runOnJS(notify)();
    });
  }, [collapsed, open, spring]);

  const style = useAnimatedStyle(() =>
    // At rest and open the row keeps its natural height, so content changes still reflow it.
    open.value === 1 || !measured
      ? { opacity: 1 }
      : { height: height.value * open.value, opacity: open.value, overflow: "hidden" },
  );

  const onLayout = (event: LayoutChangeEvent) => {
    height.value = event.nativeEvent.layout.height;
    setMeasured(true);
  };

  return (
    <Animated.View style={style} aria-hidden={collapsed || undefined}>
      <View onLayout={onLayout}>{children}</View>
    </Animated.View>
  );
}
