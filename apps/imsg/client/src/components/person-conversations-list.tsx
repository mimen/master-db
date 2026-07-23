import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary } from "@shared/types";
import { formatListTimestamp } from "@/lib/format";
import { useTheme } from "@/hooks/use-theme";
import { ListRow } from "./list-row";

export interface PersonConversationsListProps {
  chats: ChatSummary[];
  onOpenChat: (chat: ChatSummary) => void;
}

/** Every chat (1:1 + groups) this person is in, newest first, tap to jump in. */
export function PersonConversationsList({ chats, onOpenChat }: PersonConversationsListProps) {
  const theme = useTheme();
  if (chats.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
        {chats.length === 1 ? "Conversation" : `${chats.length} conversations`}
      </Text>
      {chats.map((c) => (
        <ListRow
          key={c.guid}
          paddingHorizontal={0}
          style={[styles.chatRow, { borderBottomColor: theme.divider }]}
          onPress={() => onOpenChat(c)}
          leading={
            <Ionicons
              name={c.isGroup ? "people-circle-outline" : "chatbubble-ellipses-outline"}
              size={20}
              color={theme.textSecondary}
            />
          }
          title={c.displayName}
          subtitle={c.lastMessage?.text || undefined}
          trailing={
            c.lastMessage?.dateCreated ? (
              <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                {formatListTimestamp(c.lastMessage.dateCreated)}
              </Text>
            ) : undefined
          }
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { width: "100%", marginTop: 20 },
  sectionLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", marginBottom: 8 },
  chatRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
