import { useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { api } from "@/lib/api";
import { useForwardTargets } from "@/hooks/use-forward-targets";
import { takeForwardText } from "@/lib/forward";
import { selectChat } from "@/lib/selection";
import { showToast } from "@/lib/toast";
import type { ChatSummary } from "@shared/types";
import { ChatAvatar } from "@/components/avatar";
import { CenteredSpinner, EmptyState } from "@/components/empty-state";
import { ListRow } from "@/components/list-row";
import { useTheme } from "@/hooks/use-theme";

export default function ForwardScreen() {
  const theme = useTheme();
  const { results, loading, query, setQuery } = useForwardTargets();
  const [text] = useState(() => takeForwardText());

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
      {loading ? (
        <CenteredSpinner />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(c) => c.guid}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<EmptyState message="No matching chats" />}
          renderItem={({ item }) => (
            <ListRow
              titleWeight="400"
              onPress={() => forwardTo(item)}
              leading={<ChatAvatar chat={item} size={40} />}
              title={item.displayName}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { margin: 12, marginBottom: 0, borderRadius: 12, padding: 12 },
  input: { margin: 12, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 17 },
});
