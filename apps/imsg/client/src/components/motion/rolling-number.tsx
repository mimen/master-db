import { useEffect, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type WithSpringConfig } from "react-native-reanimated";

import { useSpring } from "@/constants/springs";

import { digitPlaces } from "./math";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export interface RollingNumberProps {
  readonly value: number;
  /** Every wheel is one line tall, so the style needs a numeric lineHeight. */
  readonly style: StyleProp<TextStyle>;
}

/**
 * A badge count whose changed digits roll vertically on snappy while unchanged digits stay still.
 * When the digit count changes (9 to 10) the clipped, right-aligned row morphs its width.
 */
export function RollingNumber({ value, style }: RollingNumberProps): React.JSX.Element {
  const spring = useSpring("snappy");
  const lineHeight = StyleSheet.flatten(style).lineHeight ?? 16;
  const places = digitPlaces(value);
  const [digitWidth, setDigitWidth] = useState(0);
  const width = useSharedValue(0);

  useEffect(() => {
    const target = digitWidth * places.length;
    width.value = width.value === 0 ? target : withSpring(target, spring);
  }, [digitWidth, places.length, spring, width]);

  // Unmeasured, the row sizes to the plain number below, so the first paint already has its width.
  const row = useAnimatedStyle(() => (width.value === 0 ? {} : { width: width.value }));

  return (
    <View accessible accessibilityLabel={String(value)}>
      <Text aria-hidden style={[style, styles.measure]} onLayout={(e) => setDigitWidth(e.nativeEvent.layout.width)}>
        0
      </Text>
      <Animated.View style={[styles.row, { height: lineHeight }, row]}>
        {digitWidth > 0 ? places.map(({ key, digit }) => (
          <Wheel key={key} digit={digit} width={digitWidth} lineHeight={lineHeight} style={style} spring={spring} />
        )) : <Text aria-hidden style={[style, styles.digit]}>{value}</Text>}
      </Animated.View>
    </View>
  );
}

function Wheel({ digit, width, lineHeight, style, spring }: {
  digit: number;
  width: number;
  lineHeight: number;
  style: StyleProp<TextStyle>;
  spring: WithSpringConfig;
}): React.JSX.Element {
  const roll = useSharedValue(digit);
  useEffect(() => {
    roll.value = withSpring(digit, spring);
  }, [digit, roll, spring]);
  const wheel = useAnimatedStyle(() => ({ transform: [{ translateY: -roll.value * lineHeight }] }));
  return (
    <Animated.View style={[{ width }, wheel]}>
      {DIGITS.map((n) => (
        <Text key={n} aria-hidden style={[style, styles.digit, { height: lineHeight }]}>{n}</Text>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  measure: { position: "absolute", opacity: 0, fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", justifyContent: "flex-end", overflow: "hidden", alignSelf: "flex-start" },
  digit: { textAlign: "center", fontVariant: ["tabular-nums"] },
});
