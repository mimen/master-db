import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";

import { springConfig } from "@/constants/springs";
import { Space } from "@/constants/tokens";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";

import { edgeSprings } from "./math";

// TODO(signal-tokens): round4/tokens.json color.lensBar.
const LENS_BAR = { light: "#EC5A1E", dark: "#FF6A2B" } as const;

export interface LiquidTab<K extends string> {
  readonly key: K;
  readonly label: string;
}

export interface LiquidTabsProps<K extends string> {
  readonly tabs: readonly LiquidTab<K>[];
  readonly value: K;
  readonly onChange: (key: K) => void;
  /** Draws a tab's label (and any count) in the color that marks its selection. */
  readonly renderLabel: (tab: LiquidTab<K>, color: string) => ReactNode;
}

type Edges = { left: number; right: number };

/**
 * The lens row's 2px underline. Its leading inset moves on snappy and its trailing inset on lazy,
 * so it stretches toward the new tab and then contracts. Label color changes instantly; under
 * Reduce Motion the underline jumps.
 */
export function LiquidTabs<K extends string>({ tabs, value, onChange, renderLabel }: LiquidTabsProps<K>): React.JSX.Element {
  const theme = useTheme();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const reduceMotion = useReducedMotion();
  const [rowWidth, setRowWidth] = useState(0);
  const [boxes, setBoxes] = useState<Partial<Record<K, { x: number; width: number }>>>({});
  const left = useSharedValue(0);
  const right = useSharedValue(0);
  const placed = useRef(false);
  const previous = useRef(value);

  const box = boxes[value];
  useEffect(() => {
    if (!box || rowWidth === 0) return;
    const target: Edges = { left: box.x, right: rowWidth - box.x - box.width };
    const from = tabs.findIndex((tab) => tab.key === previous.current);
    const to = tabs.findIndex((tab) => tab.key === value);
    previous.current = value;
    if (!placed.current) {
      placed.current = true;
      left.value = target.left;
      right.value = target.right;
      return;
    }
    const edges = edgeSprings(to > from);
    left.value = withSpring(target.left, springConfig(edges.left, reduceMotion));
    right.value = withSpring(target.right, springConfig(edges.right, reduceMotion));
  }, [box, left, reduceMotion, right, rowWidth, tabs, value]);

  const underline = useAnimatedStyle(() => ({ left: left.value, right: right.value }));

  return (
    <View role="tablist" style={styles.row} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
      {tabs.map((tab) => {
        const selected = tab.key === value;
        const color = selected ? theme.text : theme.textTertiary;
        return (
          <Pressable
            key={tab.key}
            role="tab"
            aria-selected={selected}
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.key)}
            onLayout={(e) => {
              const { x, width } = e.nativeEvent.layout;
              setBoxes((current) => ({ ...current, [tab.key]: { x, width } }));
            }}
            style={styles.tab}
          >
            {renderLabel(tab, color)}
          </Pressable>
        );
      })}
      {box && <Animated.View aria-hidden style={[styles.underline, { backgroundColor: LENS_BAR[scheme] }, underline]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: Space.lg },
  tab: { flexDirection: "row", alignItems: "baseline", paddingBottom: 10 },
  underline: { position: "absolute", bottom: -1, height: 2, borderRadius: 2 },
});
