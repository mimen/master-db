import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ScheduledMessage } from "@shared/types";
import { CenteredSpinner, EmptyState } from "@/components/empty-state";
import { HoverFillButton } from "@/components/hover-fill-button";
import { ScheduleEditor } from "@/components/schedule-editor";
import { formatScheduledWhen, useScheduled } from "@/hooks/use-scheduled";
import { scheduledStatusLabel } from "@/lib/scheduled";
import { useTheme } from "@/hooks/use-theme";
import { showToast } from "@/lib/toast";
import { Radii, Spacing, Type } from "@/constants/theme";

export interface ScheduledContentProps {
  /** Desktop pane wants its own header with a close button. */
  showHeader?: boolean;
  onClose?: () => void;
}

/**
 * The scheduled-message queue — list of pending/failed/sent rows with
 * edit / send-now / cancel. Follows the shared-content contract
 * (showHeader/onClose) so this one component serves both the mobile
 * /scheduled modal and the desktop right pane — same pattern as
 * settings-content.tsx / person-content.tsx / chat-info-content.tsx.
 */
export function ScheduledContent({ showHeader = false, onClose }: ScheduledContentProps) {
  const theme = useTheme();
  const { items, loading, cancel, sendNow, edit } = useScheduled();
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);

  const header = showHeader ? (
    <View style={[styles.paneHeader, { borderBottomColor: theme.divider }]}>
      <Text style={[styles.paneHeaderTitle, { color: theme.text }]}>Scheduled</Text>
      {onClose && (
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close scheduled">
          <Ionicons name="close" size={20} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
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
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: Spacing.three, gap: 10 }}
          ListEmptyComponent={<EmptyState message="No scheduled messages" />}
          renderItem={({ item }) => {
            const editable = item.status === "pending";
            const errorState =
              item.status === "failed" || item.status === "interrupted" || item.status === "expired";
            const statusColor = errorState
              ? theme.destructive
              : item.status === "pending"
                ? theme.accent
                : theme.textSecondary;
            return (
              <Pressable
                onPress={editable ? () => setEditing(item) : undefined}
                style={[styles.card, { backgroundColor: theme.backgroundElement }]}
              >
                <View style={styles.cardHeader}>
                  <Text numberOfLines={1} style={[styles.chatName, { color: theme.text }]}>{item.chatName}</Text>
                  {editable ? (
                    <HoverFillButton
                      accessibilityLabel={`Cancel scheduled message to ${item.chatName}`}
                      onPress={(event) => { event.stopPropagation(); cancel(item.id); }}
                      restFill="transparent"
                      hoverFill={theme.backgroundSelected}
                      style={styles.iconAction}
                    >
                      <Ionicons name="close" size={16} color={theme.textSecondary} />
                    </HoverFillButton>
                  ) : null}
                </View>
                <Text numberOfLines={3} style={[styles.message, { color: theme.text }]}>{item.text}</Text>
                <View style={styles.cardFooter}>
                  <Text style={[styles.status, { color: statusColor }]}>
                    {item.status === "pending" ? `${formatScheduledWhen(item.sendAt)} · ` : ""}
                    {scheduledStatusLabel(item.status)}
                    {item.error ? ` · ${item.error}` : ""}
                  </Text>
                  {editable ? (
                    <View style={styles.actions}>
                      <HoverFillButton accessibilityLabel={`Edit scheduled message to ${item.chatName}`} onPress={(event) => { event.stopPropagation(); setEditing(item); }} restFill="transparent" hoverFill={theme.backgroundSelected} style={styles.textAction}>
                        <Text style={[styles.actionText, { color: theme.textSecondary }]}>Edit</Text>
                      </HoverFillButton>
                      <HoverFillButton accessibilityLabel={`Send scheduled message to ${item.chatName} now`} onPress={(event) => { event.stopPropagation(); void sendNow(item.id).then(() => showToast("Sent now")).catch(() => showToast("Could not send scheduled message")); }} restFill="transparent" hoverFill={theme.backgroundSelected} style={styles.textAction}>
                        <Text style={[styles.actionText, { color: theme.accent }]}>Send now</Text>
                      </HoverFillButton>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  paneHeader: {
    flexDirection: "row",
    alignItems: "center",
    height: 58,
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  paneHeaderTitle: { fontSize: 16, fontWeight: "600" },
  card: {
    borderRadius: Radii.input,
    gap: 8,
    padding: 12,
  },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  chatName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  message: {
    fontSize: 14,
    lineHeight: 19,
  },
  cardFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  status: {
    flex: 1,
    fontSize: Type.secondary,
    lineHeight: 16,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
  },
  textAction: {
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  iconAction: {
    alignItems: "center",
    borderRadius: 7,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  actionText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
