import Ionicons from "@expo/vector-icons/Ionicons";
import type { ChatSummary } from "@shared/types";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Reanimated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

import { useTheme } from "@/hooks/use-theme";

type AgentMark = NonNullable<ChatSummary["agent"]>["attention"];

/**
 * The avatar's corner mark for what the conversation's agent wants. Shape carries the state as well
 * as color: ? needs you, ! failed, a sparkle ready, a turning ring working, an outlined sparkle open.
 * The 2px ring in the row background separates it from the avatar.
 */
export function AgentBadge({ attention, size }: { attention: AgentMark; size: number }) {
  const theme = useTheme();
  const fill: Record<AgentMark, string> = {
    needs_you: theme.turnMark,
    failed: theme.destructive,
    ready: theme.accent,
    working: theme.background,
    open: theme.backgroundElement,
  };
  const inner = size - 4;
  return (
    <View
      testID="agent-badge"
      aria-hidden
      style={[styles.badge, { width: size, height: size, borderRadius: size / 2, backgroundColor: fill[attention], borderColor: theme.background }]}
    >
      {attention === "needs_you" || attention === "failed" ? (
        <Text style={[styles.badgeGlyph, { color: theme.onAccent, fontSize: Math.round(inner * 0.75), lineHeight: inner }]}>
          {attention === "needs_you" ? "?" : "!"}
        </Text>
      ) : attention === "working" ? (
        <WorkingRing size={inner - 2} color={theme.textSecondary} />
      ) : (
        <Ionicons
          name={attention === "ready" ? "sparkles" : "sparkles-outline"}
          size={Math.round(inner * 0.67)}
          color={attention === "ready" ? theme.onAccent : theme.textTertiary}
        />
      )}
    </View>
  );
}

function WorkingRing({ size, color }: { size: number; color: string }) {
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    turn.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1);
    return () => cancelAnimation(turn);
  }, [reduceMotion, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  const ring = { width: size, height: size, borderRadius: size / 2, borderColor: color };
  return reduceMotion
    ? <View style={[styles.workingRing, ring, styles.workingStill]} />
    : <Reanimated.View style={[styles.workingRing, ring, { borderTopColor: "transparent" }, spin]} />;
}

const styles = StyleSheet.create({
  badge: { alignItems: "center", borderWidth: 2, bottom: -4, justifyContent: "center", position: "absolute", right: -4 },
  badgeGlyph: { fontWeight: "800", textAlign: "center" },
  workingRing: { borderWidth: 1.5 },
  workingStill: { borderStyle: "dotted" },
});
