import { Ionicons } from "@expo/vector-icons";
import type { Message } from "@shared/types";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { useChatDirectory } from "@/hooks/use-chat-directory";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { toggleSettleChat } from "@/hooks/use-triage-actions";
import { stripCopy, type StripTone } from "@/lib/state-strip";

import { BlurSwap } from "./motion/blur-swap";

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

function ToneIcon({ tone, colors }: { readonly tone: StripTone; readonly colors: ReturnType<typeof useTheme> }) {
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
  const colors = useTheme();
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
      <BlurSwap swapKey={`${copy.tone}:${copy.lead}`} style={styles.swapHost}>
        <View style={styles.swap}>
          <ToneIcon tone={copy.tone} colors={colors} />
          <Text numberOfLines={1} style={[styles.lead, { color: copy.tone === "turn" ? colors.turn : colors.text }]}>
            {copy.lead}
          </Text>
          {copy.detail && (
            <Text numberOfLines={1} style={[styles.detail, { color: colors.textSecondary }]}>{copy.detail}</Text>
          )}
        </View>
      </BlurSwap>
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
          style={({ pressed }) => [styles.action, (actionHovered || pressed) && { backgroundColor: colors.rowHover }]}
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
  swapHost: { flex: 1, minWidth: 0 },
  swap: {
    alignItems: "center",
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
