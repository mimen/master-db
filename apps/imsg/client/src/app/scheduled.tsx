import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ScheduledMessage } from "@shared/types";
import { CenteredSpinner, EmptyState } from "@/components/empty-state";
import { ListRow } from "@/components/list-row";
import { ScheduleEditor } from "@/components/schedule-editor";
import { formatScheduledWhen, useScheduled } from "@/hooks/use-scheduled";
import { scheduledStatusLabel } from "@/lib/scheduled";
import { useTheme } from "@/hooks/use-theme";
import { showToast } from "@/lib/toast";
import { Radii, Type } from "@/constants/theme";

export default function ScheduledScreen() {
  const theme = useTheme();
  const { items, loading, cancel, sendNow, edit } = useScheduled();
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
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
          contentContainerStyle={{ padding: 16, gap: 10 }}
          ListEmptyComponent={<EmptyState message="No scheduled messages" />}
          renderItem={({ item }) => {
            const editable = item.status === "pending";
            const errorState = item.status === "failed" || item.status === "interrupted" || item.status === "expired";
            return (
              <ListRow
                onPress={editable ? () => setEditing(item) : undefined}
                paddingHorizontal={12}
                style={[styles.card, { backgroundColor: theme.backgroundElement }]}
                title={item.chatName}
                subtitle={
                  <View>
                    <Text numberOfLines={2} style={{ color: theme.text, fontSize: 14, marginTop: 2 }}>
                      {item.text}
                    </Text>
                    <Text
                      style={{
                        color: errorState ? theme.destructive : item.status === "pending" ? theme.accent : theme.textSecondary,
                        fontSize: Type.secondary,
                        marginTop: 4,
                      }}
                    >
                      {item.status === "pending" ? `${formatScheduledWhen(item.sendAt)} · ` : ""}
                      {scheduledStatusLabel(item.status)}
                      {item.error ? ` · ${item.error}` : ""}
                    </Text>
                  </View>
                }
                trailing={
                  editable ? (
                    <View style={styles.actions}>
                      <Pressable onPress={() => setEditing(item)} hitSlop={6}>
                        <Text style={[styles.actionText, { color: theme.textSecondary }]}>Edit</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          void sendNow(item.id)
                            .then(() => showToast("Sent now"))
                            .catch(() => showToast("Could not send scheduled message"));
                        }}
                        hitSlop={6}
                      >
                        <Text style={[styles.actionText, { color: theme.accent }]}>Send now</Text>
                      </Pressable>
                      <Pressable onPress={() => cancel(item.id)} hitSlop={6}>
                        <Ionicons name="close-circle" size={22} color={theme.textSecondary} />
                      </Pressable>
                    </View>
                  ) : null
                }
              />
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radii.input,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  actionText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
