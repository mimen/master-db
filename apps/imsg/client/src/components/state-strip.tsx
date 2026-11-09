import Ionicons from "@expo/vector-icons/Ionicons";
import { mostUrgent } from "@shared/agent-attention";
import type { ConversationId, Message } from "@shared/types";
import { useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { useDesktopShellState } from "@/components/desktop-shell-context";
import { useAgentChats, useAgentEnabled } from "@/hooks/use-agent";
import { useConversation } from "@/hooks/use-chat-directory";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { useToday } from "@/hooks/use-today";
import { toggleSettleChat } from "@/hooks/use-triage-actions";
import { openAgentPane } from "@/lib/agent-pane";
import { agentStripState, type AgentStripState } from "@/lib/agent-strip";
import { laterLines } from "@/lib/later-times";
import { showToast } from "@/lib/toast";
import { stripCopy, type StripTone } from "@/lib/state-strip";
import { classifyToday } from "@/lib/today";

import { BlurSwap } from "./motion/blur-swap";
import { useDomTitle } from "./today-header";

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

const AGENT_CHIP: Record<AgentStripState, { readonly copy: string; readonly icon: React.ComponentProps<typeof Ionicons>["name"] }> = {
  asking: { copy: "Agent is asking you something", icon: "help-circle-outline" },
  working: { copy: "Agent is working", icon: "ellipsis-horizontal-circle-outline" },
  drafted: { copy: "Agent drafted a reply", icon: "create-outline" },
  replied: { copy: "Agent replied", icon: "chatbubble-ellipses-outline" },
  failed: { copy: "Agent hit an error", icon: "alert-circle-outline" },
};

interface AgentStrip { readonly state: AgentStripState; readonly chatId: string }

/** While the Agent pane is closed, what the conversation's most urgent open chat wants. */
function useAgentStrip(conversationId: ConversationId): AgentStrip | null {
  const enabled = useAgentEnabled();
  const paneOpen = useDesktopShellState((state) => state.utility?.kind === "agent");
  // Subscribed while the pane is open too (the pane holds the same query), so closing it shows the chip at once.
  const chat = mostUrgent(useAgentChats(conversationId, enabled) ?? []);
  const state = enabled && !paneOpen ? agentStripState(chat) : null;
  return state && chat ? { state, chatId: chat._id } : null;
}

/** The agent's state as one icon; its words are the tooltip and the spoken label. */
function AgentButton({ conversationId, agent, colors }: { readonly conversationId: ConversationId; readonly agent: AgentStrip; readonly colors: ReturnType<typeof useTheme> }) {
  const { copy, icon } = AGENT_CHIP[agent.state];
  const tooltip = useDomTitle(copy);
  return (
    <Pressable
      ref={tooltip}
      testID="agent-strip"
      accessibilityRole="button"
      accessibilityLabel={`${copy}. Open the agent`}
      onPress={() => openAgentPane(conversationId, agent.chatId)}
      hitSlop={4}
      style={({ hovered, pressed }) => [styles.iconAction, (hovered || pressed) && { backgroundColor: colors.rowHover }]}
    >
      <Ionicons name={icon} size={15} color={agent.state === "failed" ? colors.destructive : colors.accent} />
    </Pressable>
  );
}

/**
 * The one line on top of the composer: whose turn it is and for how long, Later's state, the reply alternates, and
 * Settle or Un-settle. Why it is your turn, Today's rank and reason stay in the lead's tooltip, or a tap on touch.
 */
export function StateStrip({
  conversationId,
  messages,
  historyComplete,
  shelf = null,
}: {
  readonly conversationId: ConversationId;
  readonly messages: readonly Message[];
  readonly historyComplete: boolean;
  readonly shelf?: ReactNode;
}) {
  const chat = useConversation(conversationId);
  const colors = useTheme();
  const { wide } = useLayoutMode();
  const now = useMinuteClock();
  const [actionHovered, setActionHovered] = useState(false);
  const agent = useAgentStrip(conversationId);
  const { view } = useToday();
  const place = chat ? classifyToday(view, chat) : null;
  const today = place?.at === "ranked" ? { rank: place.rank, reason: place.reason } : null;
  const copy = chat ? stripCopy({ chat, messages, historyComplete, now, compact: !wide, today }) : null;
  const later = laterLines(chat?.later, new Date(now))[0] ?? null;
  const details = [copy?.detail, copy?.today ? `#${copy.today.rank} today · ${copy.today.reason}` : null].filter((line): line is string => !!line);
  const tooltip = useDomTitle(details.length > 0 ? details.join("\n") : null);
  if (!chat || (!copy && !agent && !later && !shelf)) return null;

  const actionLabel = copy?.action === "unsettle" ? "Un-settle" : "Settle";
  const actionName = wide ? `${actionLabel} (⌘E)` : actionLabel;
  const lead = copy || later ? (
    <Pressable
      ref={tooltip}
      testID="strip-lead"
      accessibilityRole={details.length > 0 ? "button" : "text"}
      accessibilityLabel={[copy?.lead, later, ...details].filter(Boolean).join(". ")}
      disabled={details.length === 0}
      onPress={() => showToast(details.join(" · "))}
      style={styles.leadHost}
    >
      {/* Keyed on the state, so a settle or a new message swaps the lead in rather than cutting. */}
      <BlurSwap swapKey={`${copy?.tone}:${copy?.lead}:${later}`}>
        <View style={styles.swap}>
          {copy ? <ToneIcon tone={copy.tone} colors={colors} /> : <Ionicons name="time-outline" size={16} color={colors.icon} />}
          {copy ? (
            <Text numberOfLines={1} style={[styles.lead, { color: copy.tone === "turn" ? colors.turn : colors.text }]}>{copy.lead}</Text>
          ) : null}
          {later ? (
            <Text testID="strip-later" numberOfLines={1} style={[styles.detail, { color: copy ? colors.textSecondary : colors.text }]}>{copy ? `· ${later}` : later}</Text>
          ) : null}
        </View>
      </BlurSwap>
    </Pressable>
  ) : null;

  return (
    <View testID="state-strip" style={[styles.strip, { backgroundColor: colors.strip, borderColor: colors.divider }]}>
      {lead}
      <View style={styles.shelf}>{shelf}</View>
      {agent ? <AgentButton conversationId={conversationId} agent={agent} colors={colors} /> : null}
      {/* Waiting has a settle action too, but the strip only offers it where it is the next step. */}
      {copy && copy.tone !== "waiting" && copy.action && (
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
  leadHost: { flexShrink: 1, minWidth: 0 },
  shelf: { flex: 1, minWidth: 0 },
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
  iconAction: { alignItems: "center", borderRadius: 7, height: 26, justifyContent: "center", width: 26 },
});
