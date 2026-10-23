import Ionicons from "@expo/vector-icons/Ionicons";
import { mostUrgent } from "@shared/agent-attention";
import type { Message } from "@shared/types";
import { useContext, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { DesktopShellContext } from "@/components/desktop-shell-context";
import { useAgentChats, useAgentEnabled } from "@/hooks/use-agent";
import { useChatDirectory, useConversationRef } from "@/hooks/use-chat-directory";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { toggleSettleChat } from "@/hooks/use-triage-actions";
import { openAgentPane } from "@/lib/agent-pane";
import { agentStripState, type AgentStripState } from "@/lib/agent-strip";
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

const AGENT_CHIP: Record<AgentStripState, { readonly copy: string; readonly icon: React.ComponentProps<typeof Ionicons>["name"] }> = {
  asking: { copy: "Agent is asking you something", icon: "help-circle-outline" },
  working: { copy: "Agent is working", icon: "ellipsis-horizontal-circle-outline" },
  drafted: { copy: "Agent drafted a reply", icon: "create-outline" },
  replied: { copy: "Agent replied", icon: "chatbubble-ellipses-outline" },
  failed: { copy: "Agent hit an error", icon: "alert-circle-outline" },
};

interface AgentStrip { readonly state: AgentStripState; readonly chatId: string }

/** While the Agent pane is closed, what the conversation's most urgent open chat wants. */
function useAgentStrip(chatGuid: string): AgentStrip | null {
  const enabled = useAgentEnabled();
  const shell = useContext(DesktopShellContext);
  const paneOpen = shell?.state.utility?.kind === "agent";
  const { conversationId } = useConversationRef(chatGuid);
  // Subscribed while the pane is open too (the pane holds the same query), so closing it shows the chip at once.
  const chat = mostUrgent(useAgentChats(conversationId, enabled) ?? []);
  const state = enabled && !paneOpen ? agentStripState(chat) : null;
  return state && chat ? { state, chatId: chat._id } : null;
}

function AgentChip({ chatGuid, agent, colors }: { readonly chatGuid: string; readonly agent: AgentStrip; readonly colors: ReturnType<typeof useTheme> }) {
  const { copy, icon } = AGENT_CHIP[agent.state];
  return (
    <Pressable
      testID="agent-strip"
      accessibilityRole="button"
      accessibilityLabel={`${copy}. Open the agent`}
      onPress={() => openAgentPane(chatGuid, agent.chatId)}
      hitSlop={4}
      style={({ hovered, pressed }) => [styles.action, (hovered || pressed) && { backgroundColor: colors.rowHover }]}
    >
      <Ionicons name={icon} size={14} color={agent.state === "failed" ? colors.destructive : colors.accent} />
      <Text numberOfLines={1} style={[styles.actionText, { color: colors.text }]}>{copy}</Text>
    </Pressable>
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
  const agent = useAgentStrip(chatGuid);
  if (!chat) return null;
  const copy = stripCopy({ chat, messages, historyComplete, now, compact: !wide });
  if (!copy && !agent) return null;
  const agentChip = agent ? <AgentChip chatGuid={chatGuid} agent={agent} colors={colors} /> : null;
  if (!copy) {
    return (
      <View testID="state-strip" style={[styles.strip, { backgroundColor: colors.strip, borderColor: colors.divider }]}>
        {agentChip}
      </View>
    );
  }

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
      {agentChip}
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
