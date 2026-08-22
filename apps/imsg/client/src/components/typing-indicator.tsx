import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";

const DOT_DELAYS_MS = [0, 160, 320] as const;
const BOUNCE_DURATION_MS = 550;

interface TypingIndicatorProps {
  backgroundColor?: string;
  color: string;
  label?: string;
  style?: ViewStyle;
  variant?: "bubble" | "bare";
}

export function TypingIndicator({
  backgroundColor,
  color,
  label = "Someone is typing",
  style,
  variant = "bubble",
}: TypingIndicatorProps) {
  const reduceMotion = useReducedMotion();
  const dots = DOT_DELAYS_MS.map((delay) => (
    <TypingDot color={color} delay={delay} key={delay} reduceMotion={reduceMotion} />
  ));

  return (
    <View
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      aria-label={label}
      role="status"
      style={[
        styles.dots,
        variant === "bubble" && styles.bubble,
        variant === "bubble" && { backgroundColor },
        style,
      ]}
    >
      {dots}
    </View>
  );
}

function TypingDot({
  color,
  delay,
  reduceMotion,
}: {
  color: string;
  delay: number;
  reduceMotion: boolean;
}) {
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    translateY.setValue(0);
    if (reduceMotion) return;

    const bounce = Animated.sequence([
      Animated.delay(delay),
      Animated.loop(
        Animated.sequence([
          Animated.timing(translateY, {
            duration: BOUNCE_DURATION_MS,
            easing: Easing.out(Easing.quad),
            toValue: -3,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            duration: BOUNCE_DURATION_MS,
            easing: Easing.in(Easing.quad),
            toValue: 0,
            useNativeDriver: true,
          }),
        ]),
      ),
    ]);
    bounce.start();

    return () => bounce.stop();
  }, [delay, reduceMotion, translateY]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.dot, { backgroundColor: color, transform: [{ translateY }] }]}
    />
  );
}

function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

const styles = StyleSheet.create({
  bubble: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dot: {
    borderRadius: 3,
    height: 6,
    opacity: 0.4,
    width: 6,
  },
  dots: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 4,
  },
});
