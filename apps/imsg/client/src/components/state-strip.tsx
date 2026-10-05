import { Ionicons } from "@expo/vector-icons";
import type { Message } from "@shared/types";
import { useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { useChatDirectory } from "@/hooks/use-chat-directory";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { toggleSettleChat } from "@/hooks/use-triage-actions";
import { stripCopy, type StripTone } from "@/lib/state-strip";

// TODO(signal-tokens): round4/tokens.json values until U1's tokens land.
const STRIP = {
  light: { strip: "#FFFFFF", divider: "rgba(0,0,0,0.075)", text: "#17171A", textSecondary: "#55555C", textTertiary: "#64646B", icon: "#5E5E66", turn: "#BE3A06", turnMark: "#EC5A1E", hover: "rgba(0,0,0,0.04)" },
  dark: { strip: "#19191C", divider: "rgba(255,255,255,0.07)", text: "#EDEDEF", textSecondary: "#A6A6AD", textTertiary: "#8F8F96", icon: "#97979E", turn: "#FF8A57", turnMark: "#FF6A2B", hover: "rgba(255,255,255,0.045)" },
} as const;

// TODO(signal-motion): use springs.ts
const SMOOTH = { stiffness: 189.9, damping: 25.35, mass: 1 } as const;

const MINUTE = 60_000;

/** Re-renders once a minute so "Your turn for 5h" keeps counting while the thread stays open. */
function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Content that enters with the blur swap: opacity, 6px rise and a 4px blur clearing together. */
function BlurSwapIn({ children }: { readonly children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = reduceMotion ? withTiming(1, { duration: 100 }) : withSpring(1, SMOOTH);
  }, [progress, reduceMotion]);
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    if (reduceMotion) return { opacity: p };
    return {
      opacity: p,
      transform: [{ translateY: (1 - p) * 6 }],
      ...(Platform.OS === "web" ? { filter: `blur(${Math.max(0, (1 - p) * 4)}px)` } : {}),
    };
  });
  return <Reanimated.View style={[styles.swap, style]}>{children}</Reanimated.View>;
}

function ToneIcon({ tone, colors }: { readonly tone: StripTone; readonly colors: (typeof STRIP)[keyof typeof STRIP] }) {
  if (tone === "settled") return <Ionicons name="checkmark-circle-outline" size={16} color={colors.icon} />;
  if (tone === "waiting") return <Ionicons name="time-outline" size={16} color={colors.icon} />;
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" aria-hidden>
      <Circle cx={12} cy={12} r={8.5} stroke={colors.turnMark} strokeWidth={1.6} fill="none" />
      <Circle cx={12} cy={12} r={2.6} fill={colors.turnMark} />
    </Svg>
  );
}

/**
 * The triage state of the open conversation, sitting on top of the composer card:
 * whose turn it is and for how long, with Settle or Un-settle beside it.
 */
export function StateStrip({
  chatGuid,
  messages,
  historyComplete,
}: {
  readonly chatGuid: string;
  readonly messages: readonly Message[];
  readonly historyComplete: boolean;
}) {
  const chat = useChatDirectory()?.find((c) => c.guid === chatGuid);
  const colors = STRIP[useColorScheme() === "dark" ? "dark" : "light"];
  const { wide } = useLayoutMode();
  const now = useMinuteClock();
  const [actionHovered, setActionHovered] = useState(false);
  if (!chat) return null;
  const copy = stripCopy({ chat, messages, historyComplete, now, compact: !wide });
  if (!copy) return null;

  const actionLabel = copy.action === "unsettle" ? "Un-settle" : "Settle";
  const actionName = wide ? `${actionLabel} (⌘E)` : actionLabel;
  return (
    <View testID="state-strip" style={[styles.strip, { backgroundColor: colors.strip, borderColor: colors.divider }]}>
      {/* Keyed on the state, so a settle or a new message swaps the lead in rather than cutting. */}
      <BlurSwapIn key={`${copy.tone}:${copy.lead}`}>
        <ToneIcon tone={copy.tone} colors={colors} />
        <Text numberOfLines={1} style={[styles.lead, { color: copy.tone === "turn" ? colors.turn : colors.text }]}>
          {copy.lead}
        </Text>
        {copy.detail && (
          <Text numberOfLines={1} style={[styles.detail, { color: colors.textSecondary }]}>{copy.detail}</Text>
        )}
      </BlurSwapIn>
      {/* Waiting has a settle action too, but the strip only offers it where it is the next step. */}
      {copy.tone !== "waiting" && copy.action && (
        <Pressable
          ref={(node) => { if (Platform.OS === "web") (node as unknown as HTMLElement | null)?.setAttribute("title", actionName); }}
          testID="thread-settle"
          accessibilityRole="button"
          accessibilityLabel={actionName}
          onPress={() => void toggleSettleChat(chat)}
          onHoverIn={() => setActionHovered(true)}
          onHoverOut={() => setActionHovered(false)}
          hitSlop={4}
          style={({ pressed }) => [styles.action, (actionHovered || pressed) && { backgroundColor: colors.hover }]}
        >
          <Ionicons name={copy.action === "unsettle" ? "arrow-undo-outline" : "checkmark"} size={14} color={colors.text} />
          <Text style={[styles.actionText, { color: colors.text }]}>{actionLabel}</Text>
          {wide && <Text style={[styles.kbd, { color: colors.textTertiary }]}>⌘E</Text>}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    alignItems: "center",
    borderBottomWidth: 0,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    height: 36,
    marginHorizontal: 32,
    paddingLeft: 12,
    paddingRight: 6,
  },
  swap: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
  },
  lead: { flexShrink: 0, fontSize: 12.5, fontWeight: "600" },
  detail: { flexShrink: 1, fontSize: 12.5 },
  action: {
    alignItems: "center",
    borderRadius: 7,
    flexDirection: "row",
    gap: 7,
    height: 26,
    paddingHorizontal: 8,
  },
  actionText: { fontSize: 12.5, fontWeight: "600" },
  kbd: { fontSize: 11, fontWeight: "500" },
});
