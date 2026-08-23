import type { ChatSummary } from "@shared/types";
import { useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";

import { api } from "@/lib/api";
import { takeForwardText } from "@/lib/forward";
import { showToast } from "@/lib/toast";
import { useForwardTargets } from "@/hooks/use-forward-targets";
import { useTheme } from "@/hooks/use-theme";

import { ChatAvatar } from "./avatar";
import { CenteredSpinner, EmptyState } from "./empty-state";
import { ListRow } from "./list-row";

export interface ForwardContentProps {
  readonly onClose: () => void;
  readonly onOpenChat: (chat: ChatSummary) => void;
}

/** Forward picker shared by the compact route and the wide desktop shell. */
export function ForwardContent({ onClose, onOpenChat }: ForwardContentProps): React.JSX.Element {
  const theme = useTheme();
  const { results, loading, query, setQuery } = useForwardTargets();
  const [text] = useState(() => takeForwardText());

  const forwardTo = (chat: ChatSummary): void => {
    if (!text) return;
    void api
      .sendText(chat.guid, { text })
      .then(() => {
        showToast(`Forwarded to ${chat.displayName}`);
        onClose();
        onOpenChat(chat);
      })
      .catch(() => showToast("Forward failed"));
  };

  if (!text) {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <EmptyState message="Nothing to forward" />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.preview, { backgroundColor: theme.backgroundElement }]}>
        <Text numberOfLines={2} style={{ color: theme.text, fontSize: 14 }}>
          {text}
        </Text>
      </View>
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
          keyExtractor={(chat) => chat.guid}
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
  root: { flex: 1 },
  preview: { margin: 12, marginBottom: 0, borderRadius: 12, padding: 12 },
  input: { margin: 12, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 17 },
});
