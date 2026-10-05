import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary, ScheduledMessage } from "@shared/types";
import { CenteredSpinner, EmptyState } from "@/components/empty-state";
import { ScheduleEditor } from "@/components/schedule-editor";
import { useChatDirectory } from "@/hooks/use-chat-directory";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { formatScheduledWhen, useScheduled } from "@/hooks/use-scheduled";
import { useTypeRamp } from "@/hooks/use-type";
import { chatIsSMS } from "@/lib/chat-service";
import { groupScheduled, isNotSent } from "@/lib/scheduled-groups";
import { showToast } from "@/lib/toast";
import { ChatAvatar, PersonAvatar } from "./avatar";

// TODO(signal-tokens): read from tokens.ts once U1 lands
const SIGNAL = {
  light: {
    background: "#F4F4F5", surface: "#FFFFFF", rowHover: "rgba(0,0,0,0.04)", text: "#17171A", textSecondary: "#55555C",
    textTertiary: "#64646B", icon: "#5E5E66", divider: "rgba(0,0,0,0.075)", dividerStrong: "rgba(0,0,0,0.13)",
    danger: "#C4261B", ink: "#17171A", onInk: "#FFFFFF",
  },
  dark: {
    background: "#0F0F11", surface: "#1C1C1F", rowHover: "rgba(255,255,255,0.045)", text: "#EDEDEF", textSecondary: "#A6A6AD",
    textTertiary: "#8F8F96", icon: "#97979E", divider: "rgba(255,255,255,0.07)", dividerStrong: "rgba(255,255,255,0.12)",
    danger: "#FF6B5E", ink: "#EDEDEF", onInk: "#141416",
  },
} as const;
type SignalColors = (typeof SIGNAL)["light"] | (typeof SIGNAL)["dark"];

export interface ScheduledContentProps {
  /** Desktop pane wants its own header with a close button. */
  showHeader?: boolean;
  onClose?: () => void;
}

const timeOf = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * The scheduled-message queue: "Not sent" first as fixable cards, then the
 * pending queue grouped by day. Follows the shared-content contract
 * (showHeader/onClose) so this one component serves both the mobile
 * /scheduled modal and the desktop right pane.
 */
export function ScheduledContent({ showHeader = false, onClose }: ScheduledContentProps) {
  const signal = SIGNAL[useColorScheme() === "dark" ? "dark" : "light"];
  const type = useTypeRamp();
  const chats = useChatDirectory();
  const { items, loading, cancel, sendNow, edit } = useScheduled();
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);
  const [listWidth, setListWidth] = useState(0);
  const groups = groupScheduled(items);
  const pendingCount = items.filter((item) => item.status !== "complete").length;

  const header = showHeader ? (
    <View style={[styles.paneHeader, { borderBottomColor: signal.divider }]}>
      <Text accessibilityRole="header" style={[styles.paneHeaderTitle, { color: signal.text }]}>Scheduled</Text>
      {pendingCount > 0 && <Text style={[styles.count, { color: signal.textTertiary }]}>{pendingCount}</Text>}
      <View style={{ flex: 1 }} />
      {onClose && (
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          hitSlop={8}
          accessibilityLabel="Close scheduled"
          style={({ hovered, pressed }) => [styles.headerIcon, (hovered || pressed) && { backgroundColor: signal.rowHover }]}
        >
          <Ionicons name="close" size={18} color={signal.icon} />
        </Pressable>
      )}
    </View>
  ) : null;

  const actions = {
    edit: (item: ScheduledMessage) => setEditing(item),
    cancel: (item: ScheduledMessage) => cancel(item.id),
    sendNow: (item: ScheduledMessage) =>
      void sendNow(item.id).then(() => showToast("Sent now")).catch(() => showToast("Couldn't send the scheduled message. Try again.")),
  };

  return (
    <View style={{ flex: 1, backgroundColor: signal.background }}>
      {header}
      <ScheduleEditor
        visible={editing !== null}
        title="Edit Scheduled Message"
        initialText={editing?.text ?? ""}
        initialSendAt={editing?.sendAt ?? Date.now() + 3_600_000}
        onClose={() => setEditing(null)}
        onSubmit={async (text, sendAt) => {
          if (editing) await edit(editing, text, sendAt);
        }}
      />
      {loading ? (
        <CenteredSpinner />
      ) : groups.length === 0 ? (
        <EmptyState message="Nothing scheduled. Long-press Send in a conversation to send a message later." />
      ) : (
        <ScrollView contentContainerStyle={styles.list} onLayout={(e) => setListWidth(e.nativeEvent.layout.width)}>
          {groups.map((group) => (
            <View key={group.key}>
              <View style={styles.groupHead}>
                <Text accessibilityRole="header" style={[styles.groupTitle, { color: signal.textSecondary, fontSize: type.secondary }]}>{group.title}</Text>
                <Text style={[styles.groupTitle, styles.num, { color: signal.textSecondary, fontSize: type.secondary }]}>{group.items.length}</Text>
              </View>
              {group.items.map((item) => (
                <ScheduledRow key={item.id} item={item} chat={chats?.find((c) => c.guid === item.chatGuid) ?? null} signal={signal} actions={actions} roomy={listWidth >= 560} />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function ScheduledRow({
  item,
  chat,
  signal,
  actions,
  roomy,
}: {
  item: ScheduledMessage;
  chat: ChatSummary | null;
  signal: SignalColors;
  roomy: boolean;
  actions: Record<"edit" | "cancel" | "sendNow", (item: ScheduledMessage) => void>;
}) {
  const type = useTypeRamp();
  const [hovered, setHovered] = useState(false);
  const failed = isNotSent(item.status);
  const editable = item.status === "pending" || failed;
  const service = chatIsSMS(item.chatGuid) ? "SMS" : "iMessage";
  const meta = failed
    ? `${service}, was due ${formatScheduledWhen(item.sendAt).replace(/^(Today|Tomorrow),/, (_m, day: string) => day.toLowerCase())}`
    : chat?.isGroup ? `${service}, ${chat.participants.length + 1} people` : service;
  // Web reveals the row actions as a floating group on hover; touch has no
  // hover, so they sit inline under the text instead.
  const hoverActions = Platform.OS === "web";

  const button = (label: string, a11y: string, onPress: () => void, primary = false, icon?: keyof typeof Ionicons.glyphMap) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={(event) => { event.stopPropagation(); onPress(); }}
      style={({ hovered: h, pressed }) => [
        styles.button,
        primary ? { backgroundColor: signal.ink } : { backgroundColor: signal.surface, borderColor: signal.dividerStrong, borderWidth: 1 },
        (h || pressed) && { opacity: primary ? 0.86 : 1, backgroundColor: primary ? signal.ink : signal.rowHover },
      ]}
    >
      {icon && <Ionicons name={icon} size={13} color={primary ? signal.onInk : signal.text} />}
      <Text style={[styles.buttonText, { color: primary ? signal.onInk : signal.text }]}>{label}</Text>
    </Pressable>
  );

  const failedButtons = (
    <>
      {button("Edit", `Edit scheduled message to ${item.chatName}`, () => actions.edit(item))}
      {button("Send now", `Send scheduled message to ${item.chatName} now`, () => actions.sendNow(item), true, "arrow-up")}
    </>
  );
  const quietActions = (
    <>
      <QuietAction label="Edit" a11y={`Edit scheduled message to ${item.chatName}`} signal={signal} onPress={() => actions.edit(item)} />
      <QuietAction label="Send now" a11y={`Send scheduled message to ${item.chatName} now`} signal={signal} onPress={() => actions.sendNow(item)} />
      <QuietAction icon="close" a11y={`Cancel scheduled message to ${item.chatName}`} signal={signal} onPress={() => actions.cancel(item)} />
    </>
  );

  return (
    <Pressable
      onPress={editable ? () => actions.edit(item) : undefined}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.row,
        failed && { backgroundColor: signal.surface, borderColor: signal.divider, borderWidth: 1 },
        !failed && hovered && { backgroundColor: signal.rowHover },
      ]}
    >
      {chat ? <ChatAvatar chat={chat} size={30} /> : <PersonAvatar address={null} name={item.chatName} size={30} />}
      <View style={styles.rowBody}>
        <View style={styles.who}>
          <Text numberOfLines={1} style={[styles.name, { color: signal.text, fontSize: type.body }]}>{item.chatName}</Text>
          <Text numberOfLines={1} style={[styles.meta, { color: signal.textTertiary }]}>{meta}</Text>
        </View>
        <Text numberOfLines={3} style={[styles.text, { color: signal.text }]}>{item.text}</Text>
        {failed && (
          <View style={styles.error}>
            <Ionicons name="alert-circle-outline" size={15} color={signal.danger} />
            <Text style={[styles.errorText, { color: signal.danger }]}>{`Not sent.${item.error ? ` ${item.error}` : ""}`}</Text>
          </View>
        )}
        {failed && !roomy && <View style={[styles.buttons, styles.buttonsBelow]}>{failedButtons}</View>}
        {!failed && editable && !hoverActions && <View style={styles.inlineActions}>{quietActions}</View>}
      </View>
      {failed && roomy && <View style={styles.buttons}>{failedButtons}</View>}
      {!failed && (
        <Text style={[styles.when, { color: signal.textSecondary }]}>
          {item.status === "complete" ? "Sent" : item.status === "in-progress" ? "Sending…" : timeOf(item.sendAt)}
        </Text>
      )}
      {!failed && editable && hoverActions && hovered && (
        <View style={[styles.floating, { backgroundColor: signal.surface, borderColor: signal.divider }]}>{quietActions}</View>
      )}
    </Pressable>
  );
}

function QuietAction({ label, icon, a11y, signal, onPress }: { label?: string; icon?: keyof typeof Ionicons.glyphMap; a11y: string; signal: SignalColors; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={6}
      onPress={(event) => { event.stopPropagation(); onPress(); }}
      style={({ hovered, pressed }) => [styles.quietAction, (hovered || pressed) && { backgroundColor: signal.rowHover }]}
    >
      {icon ? <Ionicons name={icon} size={15} color={signal.icon} /> : <Text style={[styles.buttonText, { color: signal.textSecondary }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  paneHeader: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 10, height: 52, paddingLeft: 22, paddingRight: 12 },
  paneHeaderTitle: { fontSize: 15.5, fontWeight: "600", letterSpacing: -0.15 },
  count: { fontSize: 12, fontVariant: ["tabular-nums"] },
  headerIcon: { alignItems: "center", borderRadius: 6, height: 28, justifyContent: "center", width: 28 },
  list: { alignSelf: "center", maxWidth: 760, paddingBottom: 32, paddingHorizontal: 24, paddingTop: 8, width: "100%" },
  groupHead: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 8, paddingHorizontal: 4, paddingTop: 22 },
  groupTitle: { fontWeight: "400" },
  num: { fontVariant: ["tabular-nums"] },
  row: { alignItems: "flex-start", borderRadius: 12, flexDirection: "row", gap: 12, marginBottom: 3, padding: 12 },
  rowBody: { flex: 1, minWidth: 0 },
  who: { alignItems: "baseline", flexDirection: "row", gap: 8 },
  name: { flexShrink: 0, fontWeight: "600", maxWidth: "75%" },
  meta: { flexShrink: 1, fontSize: 12 },
  text: { fontSize: 13.5, lineHeight: 19, marginTop: 3 },
  error: { alignItems: "center", flexDirection: "row", gap: 6, marginTop: 8 },
  errorText: { flexShrink: 1, fontSize: 12.5, fontWeight: "500" },
  buttons: { flexDirection: "row", gap: 6 },
  button: { alignItems: "center", borderRadius: 8, flexDirection: "row", gap: 6, height: 30, paddingHorizontal: 12 },
  buttonText: { fontSize: 12.5, fontWeight: "600" },
  buttonsBelow: { marginTop: 10 },
  inlineActions: { flexDirection: "row", gap: 2, marginLeft: -6, marginTop: 6 },
  floating: { borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 2, padding: 2, position: "absolute", right: 8, top: 8 },
  quietAction: { alignItems: "center", borderRadius: 6, height: 26, justifyContent: "center", minWidth: 26, paddingHorizontal: 6 },
  when: { fontSize: 12.5, fontVariant: ["tabular-nums"], textAlign: "right" },
});
