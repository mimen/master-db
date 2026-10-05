import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";

import { Springs } from "@/constants/springs";
import { useTheme } from "@/hooks/use-theme";
import type { HandleService } from "@/lib/contact-order";
import { headerFace } from "@/lib/header-font";
import type { ThemeColors } from "./ui/interaction";

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

export function serviceColor(colors: ThemeColors, service: HandleService): string {
  return service === "iMessage" ? colors.accent : service === "SMS" ? colors.sms : colors.icon;
}

export function ServiceDot({ service, size = 7 }: { readonly service: HandleService; readonly size?: number }): React.JSX.Element {
  const colors = useTheme();
  return <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: serviceColor(colors, service) }]} />;
}

const styles = StyleSheet.create({ dot: { flexShrink: 0 } });
