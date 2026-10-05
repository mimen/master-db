import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";

import { springConfig } from "@/constants/springs";
import { Space } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";

import { edgeSprings } from "./math";

export interface LiquidTab<K extends string> {
  readonly key: K;
  readonly label: string;
  /** Spoken instead of the label, e.g. with its count. */
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
}

export interface LiquidTabsProps<K extends string> {
  readonly tabs: readonly LiquidTab<K>[];
  readonly value: K;
  readonly onChange: (key: K) => void;
  /** Draws a tab's label (and any count) in the color that marks its selection. */
  readonly renderLabel: (tab: LiquidTab<K>, color: string) => ReactNode;
  /** Off where the tabs are a page title (the phone list). */
  readonly underline?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly tabStyle?: StyleProp<ViewStyle>;
}

type Edges = { left: number; right: number };

/**
 * The lens row's 2px underline. Its leading inset moves on snappy and its trailing inset on lazy,
 * so it stretches toward the new tab and then contracts. Label color changes instantly; under
 * Reduce Motion the underline jumps.
 */
export function LiquidTabs<K extends string>({ tabs, value, onChange, renderLabel, underline: showUnderline = true, style, tabStyle }: LiquidTabsProps<K>): React.JSX.Element {
  const theme = useTheme();
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
    <View role="tablist" style={[styles.row, style]} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
      {tabs.map((tab) => {
        const selected = tab.key === value;
        const color = selected ? theme.text : theme.textTertiary;
        return (
          <Pressable
            key={tab.key}
            role="tab"
            aria-selected={selected}
            accessibilityState={{ selected }}
            accessibilityLabel={tab.accessibilityLabel}
            accessibilityHint={tab.accessibilityHint}
            onPress={() => onChange(tab.key)}
            onLayout={(e) => {
              const { x, width } = e.nativeEvent.layout;
              setBoxes((current) => ({ ...current, [tab.key]: { x, width } }));
            }}
            style={[styles.tab, tabStyle, NO_SELECT]}
          >
            {renderLabel(tab, color)}
          </Pressable>
        );
      })}
      {showUnderline && box && <Animated.View aria-hidden style={[styles.underline, { backgroundColor: theme.lensBar }, underline]} />}
    </View>
  );
}

// A tab is a control, not text: a drag across the row must not select the labels.
const NO_SELECT = { userSelect: "none", cursor: "pointer" } as ViewStyle;

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: Space.lg },
  tab: { flexDirection: "row", alignItems: "baseline", paddingBottom: 10 },
  underline: { position: "absolute", bottom: -1, height: 2, borderRadius: 2 },
});
