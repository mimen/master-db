import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
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
import { SearchContent } from "@/components/search-content";
import { NewChatContent } from "@/components/new-chat-content";
import { Modal } from "react-native";
import { SkeletonList } from "@/components/skeleton-list";
import { ChatAvatar } from "@/components/avatar";
import { playReceive } from "@/lib/sounds";
import { TextInput } from "react-native";
import { ThreadView } from "@/components/thread-view";
import type { JumpTarget } from "@/hooks/use-messages";

export default function ChatListScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const [state, setState] = useState<StateFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [selected, setSelected] = useState<ChatSummary | null>(null);
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);
  const { chats, counts, loading, refresh } = useChats(state, type);

  useServerEvents(
    useCallback(
      (event) => {
        if (event.kind === "new-message" && !event.message.isFromMe) playReceive();
        refresh();
      },
      [refresh],
    ),
  );
  const [listFilter, setListFilter] = useState("");
  // Preserve the conversation list's scroll position across refreshes — data
  // reorders (new message → chat moves to top) must never yank the viewport.
  const chatListRef = useRef<FlatList<ChatSummary>>(null);
  const listScrollOffset = useRef(0);

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
            pinned: false,
          },
        },
      );
    });
  }, [wide, chats]);

  // Web fallback: if a data reorder still snapped the list to the top while
  // the user was scrolled down, restore their position.
  useEffect(() => {
    if (listScrollOffset.current <= 60) return;
    const frame = requestAnimationFrame(() => {
      const node = (
        chatListRef.current as unknown as { getScrollableNode?: () => HTMLElement } | null
      )?.getScrollableNode?.();
      const current = Platform.OS === "web" && node ? node.scrollTop : null;
      if (current !== null && current < 8) {
        chatListRef.current?.scrollToOffset({ offset: listScrollOffset.current, animated: false });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [chats]);

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
  const needle = listFilter.trim().toLowerCase();
  const visibleChats = needle
    ? chats.filter(
        (c) =>
          c.displayName.toLowerCase().includes(needle) ||
          (c.lastMessage?.text ?? "").toLowerCase().includes(needle),
      )
    : chats;
  const pinnedChats = chats.filter((c) => c.flags.pinned);
  const listChats = visibleChats.filter((c) => !c.flags.pinned);

  const list = (
    <SafeAreaView
      style={[styles.listPane, wide && [styles.listPaneWide, { borderColor: theme.divider }]]}
      edges={["top"]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Messages</Text>
        <View style={styles.headerButtons}>
          <Pressable
            onPress={() => (wide ? setSearchOpen(true) : router.push("/search"))}
            style={[styles.headerButton, { backgroundColor: theme.backgroundElement }]}
          >
            <Ionicons name="search" size={18} color={theme.text} />
          </Pressable>
          <Pressable
            onPress={() => (wide ? setNewChatOpen(true) : router.push("/new-chat"))}
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
        <TextInput
          value={listFilter}
          onChangeText={setListFilter}
          placeholder="Search"
          placeholderTextColor={theme.textSecondary}
          style={{
            marginHorizontal: 12,
            marginBottom: 8,
            borderRadius: 9,
            paddingHorizontal: 12,
            paddingVertical: 7,
            fontSize: 13,
            color: theme.text,
            backgroundColor: theme.backgroundElement,
          }}
        />
      )}
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
      <>
      {pinnedChats.length > 0 && !needle && (
        <View style={styles.pinnedRow}>
          {pinnedChats.slice(0, 8).map((chat) => (
            <Pressable key={chat.guid} onPress={() => openChat(chat)} style={styles.pinnedItem}>
              <ChatAvatar chat={chat} size={wide ? 48 : 62} />
              {chat.flags.unread && <View style={styles.pinnedDot} />}
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: 11, maxWidth: 70 }}>
                {chat.displayName}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <FlatList
        ref={chatListRef}
        data={listChats}
        keyExtractor={(chat) => chat.guid}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onScroll={(e) => {
          listScrollOffset.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}
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
      </>
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
      {/* Desktop overlay panels — centered, Spotlight-style */}
      <Modal visible={searchOpen} transparent animationType="fade" onRequestClose={() => setSearchOpen(false)}>
        <Pressable style={styles.overlayBackdrop} onPress={() => setSearchOpen(false)}>
          <Pressable style={[styles.overlayPanel, { backgroundColor: theme.background }]} onPress={() => undefined}>
            <SearchContent onClose={() => setSearchOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={newChatOpen} transparent animationType="fade" onRequestClose={() => setNewChatOpen(false)}>
        <Pressable style={styles.overlayBackdrop} onPress={() => setNewChatOpen(false)}>
          <Pressable style={[styles.overlayPanel, { backgroundColor: theme.background }]} onPress={() => undefined}>
            <NewChatContent onClose={() => setNewChatOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
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
  pinnedRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  pinnedItem: {
    alignItems: "center",
    gap: 3,
  },
  pinnedDot: {
    position: "absolute",
    top: 0,
    right: 4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#0A84FF",
  },
  overlayBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    paddingTop: 90,
  },
  overlayPanel: {
    width: 600,
    maxWidth: "90%",
    height: 560,
    maxHeight: "75%",
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 16 },
  },
});
