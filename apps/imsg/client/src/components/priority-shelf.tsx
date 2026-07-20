import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary } from "@shared/types";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { prefetchThread } from "@/hooks/use-messages";
import { useTheme } from "@/hooks/use-theme";

import { ChatAvatar } from "./avatar";

interface PriorityShelfProps {
  chats: readonly ChatSummary[];
  selectedGuid?: string;
  onPress: (chat: ChatSummary) => void;
  onLongPress?: (chat: ChatSummary) => void;
}

function unreadLabel(chat: ChatSummary): string {
  if (chat.unreadCount === 0) return "Unread";
  return chat.unreadCount === 1 ? "1 unread" : `${chat.unreadCount} unread`;
}

export function PriorityShelf({ chats, selectedGuid, onPress, onLongPress }: PriorityShelfProps) {
  const theme = useTheme();

  if (chats.length === 0) return null;

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`Priority conversations, ${chats.length}`}
      style={[styles.section, { borderBottomColor: theme.divider }]}
    >
      <View style={styles.heading}>
        <Text style={[styles.title, { color: theme.text }]}>Priority</Text>
        <Text style={[styles.count, { color: theme.textSecondary }]}>{chats.length}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content}>
        {chats.map((chat) => {
          const selected = chat.guid === selectedGuid;
          return (
            <Pressable
              key={chat.guid}
              accessibilityRole="button"
              accessibilityLabel={`Open ${chat.displayName}, ${unreadLabel(chat)}`}
              accessibilityState={{ selected }}
              onPress={() => onPress(chat)}
              onLongPress={() => onLongPress?.(chat)}
              onPressIn={() => prefetchThread(chat.guid)}
              style={({ pressed }) => [styles.item, { opacity: pressed ? 0.62 : 1 }]}
            >
              <View style={styles.avatarWrap}>
                <ChatAvatar chat={chat} size={58} />
                <View
                  style={[
                    styles.status,
                    {
                      backgroundColor: selected ? theme.accent : theme.background,
                      borderColor: theme.background,
                    },
                  ]}
                >
                  <Ionicons name="ellipse" size={8} color={selected ? "#FFFFFF" : theme.accent} />
                </View>
              </View>
              <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>
                {chat.displayName}
              </Text>
              <Text numberOfLines={1} style={[styles.meta, { color: theme.textSecondary }]}>
                {unreadLabel(chat)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 16,
  },
  heading: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 7,
    marginBottom: 10,
    paddingHorizontal: 18,
  },
  title: {
    fontSize: 19,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  count: {
    fontSize: 14,
    fontWeight: "500",
  },
  content: {
    gap: 16,
    paddingHorizontal: 18,
  },
  item: {
    alignItems: "center",
    width: 66,
  },
  avatarWrap: {
    marginBottom: 6,
    position: "relative",
  },
  status: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 2,
    bottom: -2,
    height: 19,
    justifyContent: "center",
    position: "absolute",
    right: -2,
    width: 19,
  },
  name: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    width: 76,
  },
  meta: {
    fontSize: 11,
    marginTop: 1,
    textAlign: "center",
    width: 76,
  },
});
