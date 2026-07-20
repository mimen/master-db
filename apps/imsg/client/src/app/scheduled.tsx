import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import type { ScheduledMessage } from "@shared/types";
import { useTheme } from "@/hooks/use-theme";

function whenLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

export default function ScheduledScreen() {
  const theme = useTheme();
  const [items, setItems] = useState<ScheduledMessage[]>([]);

  const load = () => api.listScheduled().then(setItems).catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);

  const cancel = (id: string) => {
    setItems((cur) => cur.filter((i) => i.id !== id));
    void api.cancelScheduled(id).catch(() => void load());
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={
          <Text style={{ color: theme.textSecondary, textAlign: "center", marginTop: 40 }}>
            No scheduled messages
          </Text>
        }
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>{item.chatName}</Text>
              <Text numberOfLines={2} style={{ color: theme.text, fontSize: 14, marginTop: 2 }}>
                {item.text}
              </Text>
              <Text style={{ color: "#0A84FF", fontSize: 13, marginTop: 4 }}>{whenLabel(item.sendAt)}</Text>
            </View>
            <Pressable onPress={() => cancel(item.id)} hitSlop={8}>
              <Ionicons name="close-circle" size={24} color={theme.textSecondary} />
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    padding: 12,
  },
});
