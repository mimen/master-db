import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary, StateCounts } from "@shared/types";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { SafeAreaView } from "react-native-safe-area-context";


import { ChatRow } from "./chat-row";
import { ConversationFilters, ConversationFiltersModal, type FilterAnchor } from "./conversation-filters";
import { NavSwitcher } from "./nav-switcher";
import { PriorityShelf } from "./priority-shelf";
import { SkeletonList } from "./skeleton-list";

import { useChatActions } from "@/hooks/use-chat-actions";
import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api";
import { deriveInboxModel, type InboxFilters } from "@/lib/inbox-model";
import { isListMode, registerListAdapter, subscribeListMode } from "@/lib/keyboard/controller";
import { useSyncExternalStore } from "react";

interface ConversationListPaneProps {
  chats: ChatSummary[];
  counts: StateCounts | null;
  filters: InboxFilters;
  loading: boolean;
  wide: boolean;
  selectedGuid?: string;
  onFiltersChange: (filters: InboxFilters) => void;
  onOpenChat: (chat: ChatSummary) => void;
  /** Glide-mode j/k selection: show the thread without focusing or marking read. */
  onPreviewChat?: (chat: ChatSummary) => void;
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
  onPreviewChat,
  onRefresh,
  onNewMessage,
}: ConversationListPaneProps) {
  const theme = useTheme();
  const { openMenu } = useChatActions();
  const [query, setQuery] = useState("");
  const [deepMatches, setDeepMatches] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState<FilterAnchor | null>(null);
  const [topBarH, setTopBarH] = useState(48);
  const [contentH, setContentH] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const contentHRef = useRef(0);
  const viewportHRef = useRef(0);
  const scrollYAnim = useRef(new Animated.Value(0)).current;
  const filterBtnRef = useRef<View>(null);

  // Frosted-glass top bar: content scrolls behind it at ~10% with a blur,
  // instead of a hard gradient fade. Web-only backdrop-filter; solid elsewhere.
  const glassStyle =
    Platform.OS === "web"
      ? ({
          backgroundColor: `${theme.background}E6`,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottomColor: theme.divider,
          borderBottomWidth: StyleSheet.hairlineWidth,
        } as object)
      : { backgroundColor: theme.background };
  const listRef = useRef<FlashListRef<ChatSummary>>(null);

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
  const glide = useSyncExternalStore(subscribeListMode, isListMode, () => false);
  const searchRef = useRef<TextInput>(null);

  // Keyboard adapter: glide-mode navigation follows the RENDERED order
  // (priority shelf first, then the filtered list) — not the raw chats array.
  const navRef = useRef({ model, selectedGuid, onOpenChat, onPreviewChat });
  navRef.current = { model, selectedGuid, onOpenChat, onPreviewChat };
  useEffect(() => {
    if (!wide) return;
    return registerListAdapter({
      move(delta) {
        const { model: m, selectedGuid: sel, onOpenChat: open, onPreviewChat: preview } = navRef.current;
        const navigable = m.showPriorityShelf ? [...m.priority, ...m.listChats] : m.listChats;
        if (navigable.length === 0) return;
        const idx = navigable.findIndex((ch) => ch.guid === sel);
        const target = navigable[Math.max(0, Math.min(navigable.length - 1, idx === -1 ? 0 : idx + delta))];
        if (target && target.guid !== sel) (preview ?? open)(target);
      },
      activate() {
        const { model: m, selectedGuid: sel, onOpenChat: open } = navRef.current;
        const navigable = m.showPriorityShelf ? [...m.priority, ...m.listChats] : m.listChats;
        const target = navigable.find((ch) => ch.guid === sel) ?? navigable[0];
        if (target) open(target);
      },
      focusSearch() {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        setTimeout(() => searchRef.current?.focus(), 30);
      },
    });
  }, [wide]);

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

  // Synthetic scrollbar: the native one is hidden so it doesn't run behind the
  // glass top bar. This thumb starts just below the bar while content still
  // scrolls under it. Driven by an Animated value so scrolling doesn't re-render.
  // FlashList virtualizes, so a full content height isn't known until it scrolls
  // once; estimate from row count until the real value arrives so the thumb is
  // sized correctly at rest.
  const estContentH = model.listChats.length * 76 + topBarH + 240;
  const effContentH = contentH > 0 ? contentH : estContentH;
  const trackH = Math.max(0, viewportH - topBarH - 6);
  const showThumb = viewportH > 0 && effContentH > viewportH + 4;
  const thumbH = showThumb ? Math.max(36, (trackH * viewportH) / effContentH) : 0;
  const thumbTranslate = scrollYAnim.interpolate({
    inputRange: [0, Math.max(1, effContentH - viewportH)],
    outputRange: [0, Math.max(0, trackH - thumbH)],
    extrapolate: "clamp",
  });

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
      {/* Everything scrolls together — search, filters, and priority shelf ride
          along as the list's header, passing behind the glass top bar. */}
      <View style={styles.listWrap}>
        <FlashList
          ref={listRef}
          data={model.listChats}
          keyExtractor={(chat) => chat.guid}
          maintainVisibleContentPosition={{ disabled: false }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingTop: topBarH + 8 }}
          showsVerticalScrollIndicator={false}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            viewportHRef.current = h;
            setViewportH(h);
          }}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollYAnim } } }], {
            useNativeDriver: false,
            // Source the scrollbar geometry from the scroll event (FlashList
            // virtualizes, so onContentSizeChange isn't reliable). Guarded via
            // refs so it only re-renders when a dimension actually changes.
            listener: (event: {
              nativeEvent: {
                contentOffset: { y: number };
                contentSize: { height: number };
                layoutMeasurement: { height: number };
              };
            }) => {
              const ne = event.nativeEvent;
              scrollOffset.current = ne.contentOffset.y;
              if (Math.abs(ne.contentSize.height - contentHRef.current) > 1) {
                contentHRef.current = ne.contentSize.height;
                setContentH(ne.contentSize.height);
              }
              if (Math.abs(ne.layoutMeasurement.height - viewportHRef.current) > 1) {
                viewportHRef.current = ne.layoutMeasurement.height;
                setViewportH(ne.layoutMeasurement.height);
              }
            },
          })}
          scrollEventThrottle={16}
          ListHeaderComponent={
            <View>
              <View style={[styles.searchField, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name="search" size={17} color={theme.textSecondary} />
                <TextInput
                  ref={searchRef}
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
              {model.showPriorityShelf && (
                <PriorityShelf
                  chats={model.priority}
                  selectedGuid={selectedGuid}
                  onPress={onOpenChat}
                  onLongPress={openMenu}
                />
              )}
              {/* Default "Recent" needs no label; a filtered view keeps its name. */}
              {model.sectionLabel !== "Recent" && (
                <View style={styles.sectionHeading}>
                  <Text style={[styles.sectionTitle, { color: theme.text }]}>{model.sectionLabel}</Text>
                  <Text style={[styles.sectionCount, { color: theme.textSecondary }]}>{model.sectionCount}</Text>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            loading && chats.length === 0 ? (
              <SkeletonList />
            ) : (
              <View style={styles.empty}>
                <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No conversations</Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <ChatRow
              chat={item}
              selected={wide && selectedGuid === item.guid}
              keyboardFocused={wide && glide && selectedGuid === item.guid}
              onPress={() => onOpenChat(item)}
              onChanged={onRefresh}
            />
          )}
        />
        {showThumb && (
          <Animated.View
            pointerEvents="none"
            style={[styles.scrollThumb, { top: topBarH, height: thumbH, transform: [{ translateY: thumbTranslate }] }]}
          />
        )}
        {/* Frosted top bar — floats over the scroll, the only fixed chrome. */}
        <View
          style={[styles.topBar, glassStyle]}
          onLayout={(e) => setTopBarH(e.nativeEvent.layout.height)}
        >
          {wide ? (
            <NavSwitcher active="messages" style={styles.navInline} />
          ) : (
            <Text style={[styles.title, { color: theme.text }]}>Messages</Text>
          )}
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
              accessibilityLabel="New message"
              onPress={onNewMessage}
              style={({ pressed }) => [styles.titleButton, pressed && { opacity: 0.55 }]}
            >
              <Ionicons name="create-outline" size={23} color={theme.accent} />
            </Pressable>
          </View>
        </View>
      </View>

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
    // Fills its floating card in the desktop split; the card owns width/edges.
    flex: 1,
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "space-between",
    left: 0,
    paddingBottom: 7,
    paddingHorizontal: 12,
    paddingTop: 7,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 10,
  },
  navInline: {
    flex: 1,
    marginBottom: 0,
    marginHorizontal: 0,
    marginTop: 0,
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -1.1,
    paddingLeft: 6,
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
    borderRadius: 11,
    flexDirection: "row",
    gap: 8,
    height: 38,
    marginBottom: 12,
    marginHorizontal: 18,
    marginTop: 4,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  listWrap: {
    flex: 1,
    position: "relative",
  },
  scrollThumb: {
    position: "absolute",
    right: 2,
    width: 6,
    borderRadius: 3,
    backgroundColor: "rgba(140,140,150,0.5)",
    zIndex: 5,
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
