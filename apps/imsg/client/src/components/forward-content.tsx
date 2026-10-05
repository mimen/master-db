import { runCommand } from "@/lib/convex-commands";
import { messagingCommandError } from "@/lib/messaging-api";
import type { ChatSummary } from "@shared/types";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { takeForwardText } from "@/lib/forward";
import { showToast } from "@/lib/toast";
import { useForwardTargets } from "@/hooks/use-forward-targets";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { chatIsSMS } from "@/lib/chat-service";

import { ChatAvatar } from "./avatar";
import { CenteredSpinner, EmptyState } from "./empty-state";
import { ServiceLabel } from "./service-label";
import { useTheme } from "@/hooks/use-theme";

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
    <View style={[styles.root, { backgroundColor: theme.thread }]}>
      <View style={[styles.toRow, { borderBottomColor: theme.divider }]}>
        <Text style={[styles.toLabel, { color: theme.textTertiary }]}>To</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Forward to…"
          placeholderTextColor={theme.textTertiary}
          autoFocus
          style={[styles.input, { color: theme.text }]}
        />
      </View>
      <View style={[styles.preview, { backgroundColor: theme.surface, borderColor: theme.dividerStrong }]}>
        <Text numberOfLines={2} style={{ color: theme.text, fontSize: 13.5, lineHeight: 19 }}>
          {text}
        </Text>
      </View>
      {loading ? (
        <CenteredSpinner />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(chat) => chat.guid}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState message="No matching chats" />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.displayName}
              onPress={() => forwardTo(item)}
              style={({ hovered, pressed }) => [styles.row, (hovered || pressed) && { backgroundColor: theme.rowHover }]}
            >
              <ChatAvatar chat={item} size={28} />
              <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>{item.displayName}</Text>
              <ServiceLabel service={chatIsSMS(item.guid) ? "SMS" : "iMessage"} size={12} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  toRow: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 6, minHeight: 52, paddingHorizontal: 22, paddingVertical: 10 },
  toLabel: { fontSize: 13.5, marginRight: 4 },
  input: { flex: 1, fontSize: 13.5, paddingVertical: 2 },
  preview: { borderRadius: 12, borderWidth: 1, marginHorizontal: 16, marginTop: 12, padding: 12 },
  list: { padding: 8 },
  row: { alignItems: "center", borderRadius: 10, flexDirection: "row", gap: 11, minHeight: 44, paddingHorizontal: 10 },
  name: { flex: 1, fontSize: 13.5 },
});
