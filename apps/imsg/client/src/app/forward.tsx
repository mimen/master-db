import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { api } from "@/lib/api";
import { useChats } from "@/hooks/use-chats";
import { takeForwardText } from "@/lib/forward";
import { selectChat } from "@/lib/selection";
import { showToast } from "@/lib/toast";
import type { ChatSummary } from "@shared/types";
import { ChatAvatar } from "@/components/avatar";
import { useTheme } from "@/hooks/use-theme";

export default function ForwardScreen() {
  const theme = useTheme();
  const { chats } = useChats("all", "all");
  const [query, setQuery] = useState("");
  const [text] = useState(() => takeForwardText());

  const filtered = useMemo(() => {
    const n = query.trim().toLowerCase();
    return (n ? chats.filter((c) => c.displayName.toLowerCase().includes(n)) : chats).slice(0, 40);
  }, [chats, query]);

  const forwardTo = (chat: ChatSummary) => {
    if (!text) {
      router.back();
      return;
    }
    api
      .sendText(chat.guid, { text })
      .then(() => {
        showToast(`Forwarded to ${chat.displayName}`);
        router.back();
        selectChat({ guid: chat.guid, name: chat.displayName });
      })
      .catch(() => showToast("Forward failed"));
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {text && (
        <View style={[styles.preview, { backgroundColor: theme.backgroundElement }]}>
          <Text numberOfLines={2} style={{ color: theme.text, fontSize: 14 }}>
            {text}
          </Text>
        </View>
      )}
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Forward to…"
        placeholderTextColor={theme.textSecondary}
        autoFocus
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <FlatList
        data={filtered}
        keyExtractor={(c) => c.guid}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundElement }]}
            onPress={() => forwardTo(item)}
          >
            <ChatAvatar chat={item} size={40} />
            <Text style={{ color: theme.text, fontSize: 16 }}>{item.displayName}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { margin: 12, marginBottom: 0, borderRadius: 12, padding: 12 },
  input: { margin: 12, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 17 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
});
