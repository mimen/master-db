import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary, StateCounts } from "@shared/types";
import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";

import { ChatRow } from "./chat-row";
import { ConversationFilters, ConversationFiltersModal, type FilterAnchor } from "./conversation-filters";
import { PriorityShelf } from "./priority-shelf";
import { SkeletonList } from "./skeleton-list";

import { useChatActions } from "@/hooks/use-chat-actions";
import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api";
import { deriveInboxModel, type InboxFilters } from "@/lib/inbox-model";

interface ConversationListPaneProps {
  chats: ChatSummary[];
  counts: StateCounts | null;
  filters: InboxFilters;
  loading: boolean;
  wide: boolean;
  selectedGuid?: string;
  onFiltersChange: (filters: InboxFilters) => void;
  onOpenChat: (chat: ChatSummary) => void;
  onRefresh: () => void;
  onNewMessage: () => void;
}

export function ConversationListPane({
  chats,
  counts,
  filters,
  loading,
  wide,
  selectedGuid,
  onFiltersChange,
  onOpenChat,
  onRefresh,
  onNewMessage,
}: ConversationListPaneProps) {
  const theme = useTheme();
  const { openMenu } = useChatActions();
  const [query, setQuery] = useState("");
  const [deepMatches, setDeepMatches] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState<FilterAnchor | null>(null);
  const filterBtnRef = useRef<View>(null);
  const listRef = useRef<FlatList<ChatSummary>>(null);

  // Desktop opens filters as a popover mounted at the button; mobile as a sheet.
  const openFilters = (): void => {
    if (wide && filterBtnRef.current) {
      filterBtnRef.current.measureInWindow((x, y, width, height) => {
        setFilterAnchor({ x, y, width, height });
        setFilterOpen(true);
      });
    } else {
      setFilterAnchor(null);
      setFilterOpen(true);
    }
  };
  const scrollOffset = useRef(0);
  const model = deriveInboxModel(chats, filters, query, deepMatches);

  // Deep search: match conversations by message body, merged into the live
  // filter so typing surfaces chats even when the term is buried in history.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setDeepMatches(new Set());
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      api
        .search(q)
        .then((messages) => {
          if (!cancelled) setDeepMatches(new Set(messages.map((m) => m.chatGuid)));
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  // A realtime reorder must not yank an already-scrolled web list to the top.
  useEffect(() => {
    if (scrollOffset.current <= 60) return;
    const frame = globalThis.requestAnimationFrame(() => {
      const node = (
        listRef.current as unknown as { getScrollableNode?: () => HTMLElement } | null
      )?.getScrollableNode?.();
      const current = Platform.OS === "web" && node ? node.scrollTop : null;
      if (current !== null && current < 8) {
        listRef.current?.scrollToOffset({ offset: scrollOffset.current, animated: false });
      }
    });
    return () => globalThis.cancelAnimationFrame(frame);
  }, [chats]);

  return (
    <SafeAreaView
      style={[
        styles.pane,
        wide && styles.paneWide,
        wide && { borderRightColor: theme.divider },
        { backgroundColor: theme.background },
      ]}
      edges={["top"]}
    >
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: theme.text }]}>Messages</Text>
        <View style={styles.titleActions}>
          <Pressable
            ref={filterBtnRef}
            accessibilityRole="button"
            accessibilityLabel="Filter conversations"
            onPress={openFilters}
            style={({ pressed }) => [styles.titleButton, pressed && { opacity: 0.55 }]}
          >
            <Ionicons name="options-outline" size={21} color={theme.accent} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Contacts"
            onPress={() => router.push("/contacts")}
            style={({ pressed }) => [styles.titleButton, pressed && { opacity: 0.55 }]}
          >
            <Ionicons name="person-circle-outline" size={23} color={theme.accent} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New message"
            onPress={onNewMessage}
            style={({ pressed }) => [styles.titleButton, pressed && { opacity: 0.55 }]}
          >
            <Ionicons name="create-outline" size={23} color={theme.accent} />
          </Pressable>
        </View>
      </View>

      <View style={[styles.searchField, { backgroundColor: theme.backgroundElement }]}>
        <Ionicons name="search" size={17} color={theme.textSecondary} />
        <TextInput
          accessibilityLabel="Search conversations and messages"
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={[styles.searchInput, { color: theme.text }]}
        />
      </View>

      <ConversationFilters filters={filters} counts={counts} onFiltersChange={onFiltersChange} />

      {loading && chats.length === 0 ? (
        <SkeletonList />
      ) : (
        <View style={styles.results}>
          {model.showPriorityShelf && (
            <PriorityShelf
              chats={model.priority}
              selectedGuid={selectedGuid}
              onPress={onOpenChat}
              onLongPress={openMenu}
            />
          )}
          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>{model.sectionLabel}</Text>
            <Text style={[styles.sectionCount, { color: theme.textSecondary }]}>{model.sectionCount}</Text>
          </View>
          <View style={styles.listWrap}>
            <FlatList
              ref={listRef}
              data={model.listChats}
              keyExtractor={(chat) => chat.guid}
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              onScroll={(event) => {
                scrollOffset.current = event.nativeEvent.contentOffset.y;
              }}
              scrollEventThrottle={32}
              ItemSeparatorComponent={() => (
                <View style={[styles.separator, { backgroundColor: theme.divider }]} />
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No conversations</Text>
                </View>
              }
              renderItem={({ item }) => (
                <ChatRow
                  chat={item}
                  selected={wide && selectedGuid === item.guid}
                  onPress={() => onOpenChat(item)}
                  onChanged={onRefresh}
                />
              )}
            />
            <LinearGradient
              colors={[theme.background, `${theme.background}00`]}
              style={styles.topFade}
              pointerEvents="none"
            />
          </View>
        </View>
      )}

      <ConversationFiltersModal
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        anchor={filterAnchor}
        filters={filters}
        counts={counts}
        onFiltersChange={onFiltersChange}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pane: {
    flex: 1,
  },
  paneWide: {
    borderRightWidth: StyleSheet.hairlineWidth,
    flexBasis: 390,
    flexGrow: 0,
    flexShrink: 0,
    width: 390,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 9,
    paddingHorizontal: 18,
    paddingTop: 6,
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -1.1,
  },
  titleActions: {
    flexDirection: "row",
    gap: 2,
  },
  titleButton: {
    alignItems: "center",
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  searchField: {
    alignItems: "center",
    borderRadius: 10,
    flexDirection: "row",
    gap: 7,
    height: 36,
    marginBottom: 4,
    marginHorizontal: 18,
    paddingHorizontal: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  results: {
    flex: 1,
  },
  listWrap: {
    flex: 1,
    position: "relative",
  },
  topFade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 14,
  },
  sectionHeading: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 7,
    paddingBottom: 6,
    paddingHorizontal: 18,
    paddingTop: 15,
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  sectionCount: {
    fontSize: 14,
    fontWeight: "500",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 88,
  },
  empty: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 36,
  },
  emptyText: {
    fontSize: 15,
  },
});
