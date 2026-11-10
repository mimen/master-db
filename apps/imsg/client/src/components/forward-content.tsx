import type { ChatSummary } from "@shared/types";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { takeForwardText } from "@/lib/forward";
import { pendingSends } from "@/lib/pending-sends";
import { useForwardTargets } from "@/hooks/use-forward-targets";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { conversationRoute } from "@shared/imessage";
import { platformBadge } from "@shared/platform-profile";

import { ChatAvatar } from "./avatar";
import { ChipField, ComposeSheet, SheetFooter } from "./compose-sheet";
import { CenteredSpinner, EmptyState } from "./empty-state";
import { SourceIcon } from "./service-label";
import { useTheme } from "@/hooks/use-theme";

export interface ForwardContentProps {
  readonly onClose: () => void;
  readonly onOpenChat: (chat: ChatSummary) => void;
  /** A phone route draws the sheet as its page. */
  readonly presentation?: "overlay" | "screen";
}

/**
 * Forward a message, on the compose sheet: pick one or more chats into To, then Send. Enter in To adds the top match,
 * and once a chat is picked, sends.
 */
export function ForwardContent({ onClose, onOpenChat, presentation }: ForwardContentProps): React.JSX.Element | null {
  const theme = useTheme();
  const { wide } = useLayoutMode();
  const { results, loading, query, setQuery } = useForwardTargets();
  const [text] = useState(() => takeForwardText());
  const [targets, setTargets] = useState<ChatSummary[]>([]);
  const picking = query.trim() !== "" || targets.length === 0;
  const offered = results.filter((chat) => !targets.some((target) => target.conversationId === chat.conversationId));

  const add = (chat: ChatSummary): void => {
    setTargets((current) => [...current, chat]);
    setQuery("");
  };

  // The copy lands in each destination thread on the click, the way a composer send does.
  const send = (): void => {
    if (!text || targets.length === 0) return;
    const landed = targets.map((chat) => pendingSends.send(chat, { text }));
    onClose();
    if (targets.length === 1) onOpenChat(targets[0]!);
    // A send that did not go out toasts from pendingSends, with Retry and Open.
    for (const send of landed) send.catch(() => undefined);
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
    <ComposeSheet title="Forward message" presentation={presentation} dirty={false} onClose={onClose}>
      <ChipField
        label="To"
        chips={targets.map((chat) => ({ key: chat.conversationId, label: chat.displayName }))}
        onRemove={(id) => setTargets((current) => current.filter((chat) => chat.conversationId !== id))}
        input={{
          value: query,
          onChangeText: setQuery,
          placeholder: targets.length === 0 ? "Name or chat" : "Add another",
          autoFocus: true,
          blurOnSubmit: false,
          onSubmitEditing: () => {
            if (query.trim() && offered[0]) add(offered[0]);
            else if (!query.trim()) send();
          },
        }}
      />
      <View style={[styles.preview, { backgroundColor: theme.surface, borderColor: theme.divider }]}>
        <Text numberOfLines={picking ? 2 : 12} style={[styles.previewText, { color: theme.text }]}>{text}</Text>
      </View>
      {!picking ? <View style={styles.fill} /> : loading ? <CenteredSpinner /> : (
        <FlatList
          style={styles.fill}
          data={offered}
          keyExtractor={(chat) => chat.conversationId}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState message="No matching chats" />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.displayName}
              onPress={() => add(item)}
              style={({ hovered, pressed }) => [styles.row, (hovered || pressed) && { backgroundColor: theme.rowHover }]}
            >
              <ChatAvatar chat={item} size={28} />
              <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>{item.displayName}</Text>
              <SourceIcon badge={platformBadge(conversationRoute(item))} />
            </Pressable>
          )}
        />
      )}
      <SheetFooter ready={targets.length > 0} sending={false} onSend={send} />
    </ComposeSheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  preview: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginHorizontal: 16, marginVertical: 12, padding: 12 },
  previewText: { fontSize: 14, lineHeight: 20 },
  list: { paddingBottom: 8, paddingHorizontal: 8 },
  row: { alignItems: "center", borderRadius: 10, flexDirection: "row", gap: 11, minHeight: 44, paddingHorizontal: 10 },
  name: { flex: 1, fontSize: 14 },
});
