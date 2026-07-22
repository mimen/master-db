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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.leadIcon}>
          <Ionicons name="star" size={20} color="#FFCC00" />
        </View>
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
    paddingBottom: 20,
    paddingTop: 12,
  },
  content: {
    alignItems: "flex-start",
    gap: 18,
    paddingHorizontal: 18,
  },
  leadIcon: {
    alignItems: "center",
    height: 58,
    justifyContent: "center",
    marginRight: -4,
    width: 22,
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
