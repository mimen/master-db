import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { springConfig, type SpringPreset } from "@/constants/springs";

export interface BlurSwapProps {
  /** Changing the key swaps the content; the same key re-renders it in place. */
  readonly swapKey: string | number;
  readonly children: ReactNode;
  /** "rise" moves text ±6pt; "scale" grows an icon from 0.25. */
  readonly variant?: "rise" | "scale";
  readonly spring?: SpringPreset;
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * Morph, don't cut: old content leaves up with blur(4px) to opacity 0 while new content enters
 * from below. The leaving copy is positioned over the entering one (motion's popLayout), so the
 * two never stack in flow. Native skips the blur. Reduce Motion swaps instantly.
 */
export function BlurSwap({ swapKey, children, variant = "rise", spring = "snappy", style }: BlurSwapProps): React.JSX.Element {
  const [current, setCurrent] = useState({ key: swapKey, id: 0 });
  const [leaving, setLeaving] = useState<{ id: number; node: ReactNode; box: Box | undefined }[]>([]);
  const rendered = useRef(children);
  const box = useRef<Box | undefined>(undefined);
  useLayoutEffect(() => {
    rendered.current = children;
  });

  if (current.key !== swapKey) {
    const frozen = rendered.current;
    setLeaving((layers) => [...layers, { id: current.id, node: frozen, box: box.current }]);
    setCurrent({ key: swapKey, id: current.id + 1 });
  }

  return (
    <View style={style}>
      <Layer
        key={current.id}
        variant={variant}
        spring={spring}
        animateIn={current.id > 0}
        onBox={(b) => {
          box.current = b;
        }}
      >
        {children}
      </Layer>
      {leaving.map(({ id, node, box: frozen }) => (
        <Layer
          key={id}
          box={frozen}
          variant={variant}
          spring={spring}
          leaving
          onGone={() => setLeaving((layers) => layers.filter((layer) => layer.id !== id))}
        >
          {node}
        </Layer>
      ))}
    </View>
  );
}

type Box = { left: number; width: number };

function Layer({ children, variant, spring, leaving = false, animateIn = false, onGone, onBox, box }: {
  children: ReactNode;
  onBox?: (box: Box) => void;
  /** A leaving layer keeps the box it had in flow, so its text never rewraps to the new size. */
  box?: Box | undefined;
  variant: "rise" | "scale";
  spring: SpringPreset;
  leaving?: boolean;
  animateIn?: boolean;
  onGone?: () => void;
}): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const shown = useSharedValue(animateIn ? 0 : 1);
  const gone = useRef(onGone);
  gone.current = onGone;

  useEffect(() => {
    const notify = () => gone.current?.();
    const done = (finished?: boolean) => {
      "worklet";
      if (finished) runOnJS(notify)();
    };
    if (reduceMotion) {
      shown.value = withTiming(leaving ? 0 : 1, { duration: 0 }, done);
    } else {
      shown.value = withSpring(leaving ? 0 : 1, springConfig(spring, false), done);
    }
  }, [leaving, reduceMotion, shown, spring]);

  const animated = useAnimatedStyle(() => {
    const away = 1 - shown.value;
    if (reduceMotion) return { opacity: shown.value };
    const transform = variant === "scale"
      ? [{ scale: 0.25 + 0.75 * shown.value }]
      : [{ translateY: (leaving ? -6 : 6) * away }];
    return Platform.OS === "web"
      ? { opacity: shown.value, transform, filter: `blur(${4 * away}px)` }
      : { opacity: shown.value, transform };
  });

  return (
    <Animated.View
      aria-hidden={leaving || undefined}
      pointerEvents={leaving ? "none" : "auto"}
      // RNW reports whole-pixel layout widths; one spare pixel keeps a subpixel-wide label on one line.
      onLayout={onBox && ((e) => onBox({ left: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width + 1 }))}
      style={[leaving && styles.leaving, leaving && box, animated]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  leaving: { position: "absolute", top: 0, left: 0, bottom: 0, justifyContent: "center" },
});
