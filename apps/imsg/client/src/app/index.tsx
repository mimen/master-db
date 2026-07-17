import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { onSelectChat } from "@/lib/selection";
import { useChats } from "@/hooks/use-chats";
import { useTheme } from "@/hooks/use-theme";
import { useServerEvents } from "@/lib/sse";
import type { ChatSummary, StateFilter, TypeFilter } from "@/lib/types";
import { ChatRow } from "@/components/chat-row";
import { FilterMenu } from "@/components/filter-menu";
import { PillBar } from "@/components/pills";
import { SkeletonList } from "@/components/skeleton-list";
import { ThreadView } from "@/components/thread-view";
import type { JumpTarget } from "@/hooks/use-messages";

export default function ChatListScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const [state, setState] = useState<StateFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<ChatSummary | null>(null);
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);
  const { chats, counts, loading, refresh } = useChats(state, type);

  useServerEvents(useCallback(() => refresh(), [refresh]));

  // Wide-mode: modals publish chats to open here instead of navigating.
  useEffect(() => {
    if (!wide) return;
    return onSelectChat((selection) => {
      const known = chats.find((c) => c.guid === selection.guid);
      setJumpTarget(selection.jumpTarget ?? null);
      setSelected(
        known ?? {
          guid: selection.guid,
          displayName: selection.name ?? selection.guid,
          isGroup: selection.isGroup ?? selection.guid.includes(";+;"),
          known: true,
          isSpam: false,
          participants: [],
          lastMessage: null,
          unreadCount: 0,
          flags: {
            archived: false,
            unresponded: false,
            waiting: false,
            unread: false,
            mutedUnresponded: false,
          },
        },
      );
    });
  }, [wide, chats]);

  // Keep the selected chat's flags fresh as the list refreshes.
  useEffect(() => {
    if (!selected) return;
    const updated = chats.find((c) => c.guid === selected.guid);
    if (updated && updated !== selected) setSelected(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats]);

  const openChat = (chat: ChatSummary) => {
    if (wide) {
      setJumpTarget(null);
      setSelected(chat);
      return;
    }
    router.push({
      pathname: "/chat/[guid]",
      params: {
        guid: chat.guid,
        name: chat.displayName,
        isGroup: chat.isGroup ? "1" : "0",
        count: String(chat.participants.length),
      },
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
            <Ionicons name="search" size={18} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/new-chat")}
            style={[styles.headerButton, { backgroundColor: theme.backgroundElement }]}
          >
            <Ionicons name="create-outline" size={18} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={() => setFilterOpen(true)}
            style={[styles.headerButton, { backgroundColor: theme.backgroundElement }]}
          >
            <Ionicons name="filter" size={18} color={theme.text} />
            {activeFilters > 0 && <View style={styles.filterBadge} />}
          </Pressable>
        </View>
      </View>
      {wide && (
        <PillBar
          state={state}
          type={type}
          counts={counts}
          onStateChange={setState}
          onTypeChange={setType}
        />
      )}
      {loading && chats.length === 0 ? (
        <SkeletonList />
      ) : (
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
      )}
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
          <ThreadView
            key={selected.guid + (jumpTarget?.guid ?? "")}
            chatGuid={selected.guid}
            isGroup={selected.isGroup}
            jumpTarget={jumpTarget}
            headerChat={selected}
          />
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
