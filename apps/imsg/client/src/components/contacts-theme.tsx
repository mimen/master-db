import { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";

import { useColorScheme } from "@/hooks/use-color-scheme";
import type { HandleService } from "@/lib/contact-order";

// TODO(signal-tokens): these are round4/tokens.json's Signal values. Swap for the
// shared tokens once the look unit lands them in constants/tokens.ts.
const SIGNAL = {
  light: {
    sidebar: "#FFFFFF",
    background: "#F4F4F5",
    surface: "#FFFFFF",
    field: "rgba(0,0,0,0.045)",
    rowHover: "rgba(0,0,0,0.04)",
    rowSelected: "rgba(0,0,0,0.075)",
    text: "#17171A",
    textSecondary: "#55555C",
    textTertiary: "#64646B",
    icon: "#5E5E66",
    turn: "#BE3A06",
    focusRing: "#E0500F",
    divider: "rgba(0,0,0,0.075)",
    dividerStrong: "rgba(0,0,0,0.13)",
    imessage: "#007AFF",
    sms: "#34C759",
    avatar: "#ECECEE",
    avatarText: "#3C3C42",
    switchOn: "#17171A",
    switchOff: "#8E8E95",
    onPrimary: "#FFFFFF",
    danger: "#C4261B",
    popBg: "#FFFFFF",
  },
  dark: {
    sidebar: "#141416",
    background: "#0F0F11",
    surface: "#1C1C1F",
    field: "rgba(255,255,255,0.06)",
    rowHover: "rgba(255,255,255,0.045)",
    rowSelected: "rgba(255,255,255,0.085)",
    text: "#EDEDEF",
    textSecondary: "#A6A6AD",
    textTertiary: "#8F8F96",
    icon: "#97979E",
    turn: "#FF8A57",
    focusRing: "#FF7A40",
    divider: "rgba(255,255,255,0.07)",
    dividerStrong: "rgba(255,255,255,0.12)",
    imessage: "#0A84FF",
    sms: "#30D158",
    avatar: "#2A2A2E",
    avatarText: "#D6D6DB",
    switchOn: "#EDEDEF",
    switchOff: "#727279",
    onPrimary: "#141416",
    danger: "#FF6B5E",
    popBg: "#232326",
  },
} as const;

export type SignalColors = { readonly [K in keyof typeof SIGNAL.light]: string };

export function useSignal(): SignalColors {
  return SIGNAL[useColorScheme() === "dark" ? "dark" : "light"];
}

/** Bricolage on headers only; system everywhere else. */
export const HEADER_FONT = Platform.select({
  web: '"Bricolage Grotesque", -apple-system, system-ui, sans-serif',
  default: undefined,
});

// TODO(signal-motion): use springs.ts
const SMOOTH = { duration: 380, dampingRatio: 0.92 } as const;

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
    y.value = withSpring(0, SMOOTH);
    opacity.value = withSpring(1, SMOOTH);
  }, [motionKey, reduce, y, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: y.value }] }));
  return <Animated.View style={[{ flex: 1 }, style, animated]}>{children}</Animated.View>;
}

export function serviceColor(colors: SignalColors, service: HandleService): string {
  return service === "iMessage" ? colors.imessage : service === "SMS" ? colors.sms : colors.icon;
}

export function ServiceDot({ service, size = 7 }: { readonly service: HandleService; readonly size?: number }): React.JSX.Element {
  const colors = useSignal();
  return <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: serviceColor(colors, service) }]} />;
}

const styles = StyleSheet.create({ dot: { flexShrink: 0 } });
