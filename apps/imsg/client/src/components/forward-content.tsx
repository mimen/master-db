import { runCommand } from "@/lib/convex-commands";
import { messagingCommandError } from "@/lib/messaging-api";
import type { ChatSummary } from "@shared/types";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";

import { takeForwardText } from "@/lib/forward";
import { showToast } from "@/lib/toast";
import { useForwardTargets } from "@/hooks/use-forward-targets";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";

import { ChatAvatar } from "./avatar";
import { CenteredSpinner, EmptyState } from "./empty-state";
import { ListRow } from "./list-row";

export interface ForwardContentProps {
  readonly onClose: () => void;
  readonly onOpenChat: (chat: ChatSummary) => void;
}

/** Forward picker shared by the compact route and the wide desktop shell. */
export function ForwardContent({ onClose, onOpenChat }: ForwardContentProps): React.JSX.Element | null {
  const theme = useTheme();
  const { wide } = useLayoutMode();
  const { results, loading, query, setQuery } = useForwardTargets();
  const [text] = useState(() => takeForwardText());

  const forwardTo = (chat: ChatSummary): void => {
    if (!text) return;
    void runCommand(chat.guid, { kind: "send", text })
      .then(() => {
        showToast(`Forwarded to ${chat.displayName}`);
        onClose();
        onOpenChat(chat);
      })
      .catch((error: unknown) => showToast(messagingCommandError(error, "Forward failed")));
  };

  // Forward only opens from a message. Reached any other way (a reload, a
  // typed URL) there is nothing to send. On a cold load the route can mount
  // before the navigator, so <Redirect> (navigation-safe at mount) replaces it
  // with the inbox; the desktop overlay is plain state and just closes.
  useEffect(() => {
    if (!text && wide) onClose();
  }, [onClose, text, wide]);

  if (!text) return wide ? null : <Redirect href="/" />;

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
