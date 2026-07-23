import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CenteredSpinner, EmptyState } from "@/components/empty-state";
import { ListRow } from "@/components/list-row";
import { formatScheduledWhen, useScheduled } from "@/hooks/use-scheduled";
import { useTheme } from "@/hooks/use-theme";
import { Radii, Type } from "@/constants/theme";

export default function ScheduledScreen() {
  const theme = useTheme();
  const { items, loading, cancel } = useScheduled();

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {loading ? (
        <CenteredSpinner />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          ListEmptyComponent={<EmptyState message="No scheduled messages" />}
          renderItem={({ item }) => (
            <ListRow
              disabled
              paddingHorizontal={12}
              style={[styles.card, { backgroundColor: theme.backgroundElement }]}
              title={item.chatName}
              subtitle={
                <View>
                  <Text numberOfLines={2} style={{ color: theme.text, fontSize: 14, marginTop: 2 }}>
                    {item.text}
                  </Text>
                  <Text style={{ color: theme.accent, fontSize: Type.secondary, marginTop: 4 }}>
                    {formatScheduledWhen(item.sendAt)}
                  </Text>
                </View>
              }
              trailing={
                <Pressable onPress={() => cancel(item.id)} hitSlop={8}>
                  <Ionicons name="close-circle" size={24} color={theme.textSecondary} />
                </Pressable>
              }
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radii.input,
  },
});
