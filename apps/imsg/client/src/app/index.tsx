import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useChats } from "@/hooks/use-chats";
import { useTheme } from "@/hooks/use-theme";
import { useServerEvents } from "@/lib/sse";
import type { ChatSummary, StateFilter, TypeFilter } from "@/lib/types";
import { ChatRow } from "@/components/chat-row";
import { FilterMenu } from "@/components/filter-menu";
import { ThreadView } from "@/components/thread-view";

export default function ChatListScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const [state, setState] = useState<StateFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<ChatSummary | null>(null);
  const { chats, counts, refresh } = useChats(state, type);

  useServerEvents(useCallback(() => refresh(), [refresh]));

  const openChat = (chat: ChatSummary) => {
    if (wide) {
      setSelected(chat);
      return;
    }
    router.push({
      pathname: "/chat/[guid]",
      params: { guid: chat.guid, name: chat.displayName, isGroup: chat.isGroup ? "1" : "0" },
    });
  };

  const activeFilters = (state !== "all" ? 1 : 0) + (type !== "all" ? 1 : 0);

  const list = (
    <SafeAreaView
      style={[styles.listPane, wide && [styles.listPaneWide, { borderColor: theme.divider }]]}
      edges={["top"]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Messages</Text>
        <View style={styles.headerButtons}>
          <Pressable
            onPress={() => router.push("/search")}
            style={[styles.headerButton, { backgroundColor: theme.backgroundElement }]}
          >
            <Text style={{ fontSize: 15 }}>🔍</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/new-chat")}
            style={[styles.headerButton, { backgroundColor: theme.backgroundElement }]}
          >
            <Text style={{ fontSize: 15 }}>✏️</Text>
          </Pressable>
          <Pressable
            onPress={() => setFilterOpen(true)}
            style={[styles.headerButton, { backgroundColor: theme.backgroundElement }]}
          >
            <Text style={{ fontSize: 15, color: theme.text }}>☰</Text>
            {activeFilters > 0 && <View style={styles.filterBadge} />}
          </Pressable>
        </View>
      </View>
      <FlatList
        data={chats}
        keyExtractor={(chat) => chat.guid}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: theme.divider }]} />
        )}
        renderItem={({ item }) => (
          <ChatRow
            chat={item}
            selected={wide && selected?.guid === item.guid}
            onPress={() => openChat(item)}
            onChanged={refresh}
          />
        )}
      />
      <FilterMenu
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        state={state}
        type={type}
        counts={counts}
        onStateChange={setState}
        onTypeChange={setType}
      />
    </SafeAreaView>
  );

  if (!wide) {
    return <View style={{ flex: 1, backgroundColor: theme.background }}>{list}</View>;
  }

  return (
    <View style={[styles.split, { backgroundColor: theme.background }]}>
      {list}
      <View style={styles.threadPane}>
        {selected ? (
          <ThreadView key={selected.guid} chatGuid={selected.guid} isGroup={selected.isGroup} />
        ) : (
          <View style={styles.empty}>
            <Text style={{ color: theme.textSecondary }}>Select a conversation</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  split: {
    flex: 1,
    flexDirection: "row",
  },
  listPane: {
    flex: 1,
  },
  listPaneWide: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 380,
    width: 380,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  threadPane: {
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
  },
  headerButtons: {
    flexDirection: "row",
    gap: 8,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBadge: {
    position: "absolute",
    top: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#0A84FF",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 88,
  },
});
