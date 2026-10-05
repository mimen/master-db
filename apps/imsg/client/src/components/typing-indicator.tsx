import { useEffect, useRef } from "react";
import { useReducedMotion } from "react-native-reanimated";
import { Animated, Easing, Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { useTheme } from "@/hooks/use-theme";

// The one loop motion allows besides the send ring: each dot steps between full and 0.4 opacity, staggered.
const DOT_DELAYS_MS = [0, 200, 400] as const;
const STEP_MS = 600;
const REST_OPACITY = [1, 0.75, 0.5] as const;

interface TypingIndicatorProps {
  /** Ignored by the bubble variant, which draws the Signal theirs-bubble. */
  backgroundColor?: string;
  /** Dot color for the bare variant. */
  color?: string;
  label?: string;
  style?: ViewStyle;
  variant?: "bubble" | "bare";
}

export function TypingIndicator({
  color,
  label = "Someone is typing",
  style,
  variant = "bubble",
}: TypingIndicatorProps) {
  const reduceMotion = useReducedMotion();
  const theme = useTheme();
  const dotColor = variant === "bare" && color ? color : theme.textTertiary;

  return (
    <View
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      aria-label={label}
      role="status"
      style={[
        styles.dots,
        variant === "bubble" && styles.bubble,
        variant === "bubble" && { backgroundColor: theme.bubbleTheirs, borderColor: theme.bubbleTheirsBorder },
        style,
      ]}
    >
      {DOT_DELAYS_MS.map((delay, index) => (
        <TypingDot
          color={dotColor}
          delay={delay}
          key={delay}
          reduceMotion={reduceMotion}
          rest={REST_OPACITY[index] ?? 1}
        />
      ))}
    </View>
  );
}

function TypingDot({
  color,
  delay,
  reduceMotion,
  rest,
}: {
  color: string;
  delay: number;
  reduceMotion: boolean;
  rest: number;
}) {
  const opacity = useRef(new Animated.Value(rest)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(rest);
      return;
    }
    opacity.setValue(1);
    const native = Platform.OS !== "web";
    const pulse = Animated.sequence([
      Animated.delay(delay),
      Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { duration: STEP_MS, easing: Easing.inOut(Easing.ease), toValue: 0.4, useNativeDriver: native }),
          Animated.timing(opacity, { duration: STEP_MS, easing: Easing.inOut(Easing.ease), toValue: 1, useNativeDriver: native }),
        ]),
      ),
    ]);
    pulse.start();
    return () => pulse.stop();
  }, [delay, opacity, reduceMotion, rest]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.dot, { backgroundColor: color, opacity }]}
    />
  );
}

const styles = StyleSheet.create({
  bubble: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  dot: {
    borderRadius: 3.5,
    height: 7,
    width: 7,
  },
  dots: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 4,
  },
});
