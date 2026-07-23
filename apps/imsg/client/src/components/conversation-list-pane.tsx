import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary, StateCounts } from "@shared/types";
import { useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";


import { ChatRow } from "./chat-row";
import { ConversationFilters, ConversationFiltersModal, type FilterAnchor } from "./conversation-filters";
import { NavSwitcher } from "./nav-switcher";
import { PriorityShelf, type PriorityShelfHandle } from "./priority-shelf";
import { SkeletonList } from "./skeleton-list";

import { SidebarChrome, chromeStyles } from "./sidebar/sidebar-chrome";
import { SidebarFrame } from "./sidebar/sidebar-frame";
import { SidebarSearchField } from "./sidebar/sidebar-search-field";
import { SuggestionSettingsButton } from "./sidebar/suggestion-settings-button";
import { SyntheticScrollThumb } from "./sidebar/synthetic-scroll-thumb";
import { SIDEBAR_CHROME_HEIGHT } from "./sidebar/use-synthetic-scroll-metrics";
import { useConversationListKeyboard } from "./conversations/use-conversation-list-keyboard";
import { useConversationListViewport } from "./conversations/use-conversation-list-viewport";
import { useConversationSearch } from "./conversations/use-conversation-search";

import { useChatActions } from "@/hooks/use-chat-actions";
import { useTheme } from "@/hooks/use-theme";
import { deriveInboxModel, type InboxFilters } from "@/lib/inbox-model";
import { isListMode, subscribeListMode } from "@/lib/keyboard/controller";
import { useSyncExternalStore } from "react";

interface ConversationListPaneProps {
  chats: ChatSummary[];
  /** Unfiltered universe (archived included) — what search mode searches. */
  allChats: ChatSummary[];
  counts: StateCounts | null;
  filters: InboxFilters;
  loading: boolean;
  wide: boolean;
  selectedGuid?: string;
  onFiltersChange: (filters: InboxFilters) => void;
  onOpenChat: (chat: ChatSummary) => void;
  /** Glide-mode j/k selection: show the thread without focusing or marking
   * read. Required — keyboard moves must never fall back to opening. */
  onPreviewChat: (chat: ChatSummary) => void;
  onRefresh: () => void;
  onNewMessage: () => void;
}

export function ConversationListPane({
  chats,
  allChats,
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
  const iosMobile = Platform.OS === "ios" && !wide;
  const search = useConversationSearch({ filters, onFiltersChange });
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState<FilterAnchor | null>(null);
  const topBarH = SIDEBAR_CHROME_HEIGHT;
  const filterBtnRef = useRef<View>(null);

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
  // Search is a MODE, not a compound filter: typing searches the FULL universe
  // (archived included), superseding the badge filters; clearing the query
  // restores the badge view untouched (docs: Gmail/Superhuman convention).
  // Policy (lens wipe, deep-search tagging, clear paths) lives in
  // useConversationSearch; this pane only renders and scrolls.
  // Universe = allChats (search spans everything); blank-query browsing uses
  // useChats' FROZEN membership so triage rows never vanish mid-pass. (The
  // remount theory that motivated a single array was disproved by the
  // Playwright trap — the blur was keyboardDismissMode.)
  const browseGuids = useMemo(() => new Set(chats.map((c) => c.guid)), [chats]);
  const model = deriveInboxModel(allChats, filters, search.query, search.deepMatches, browseGuids);
  const glide = useSyncExternalStore(subscribeListMode, isListMode, () => false);

  // All imperative list scrolling (glide pinning, view resets, reorder
  // recovery) and the synthetic thumb live in the viewport hook.
  const viewport = useConversationListViewport({
    renderedChats: model.listChats,
    chromeHeight: topBarH,
    viewKey: search.viewKey,
  });
  const shelfRef = useRef<PriorityShelfHandle>(null);
  useConversationListKeyboard({
    enabled: wide,
    model,
    selectedGuid,
    viewport,
    search,
    shelf: shelfRef,
    onOpenChat,
    onPreviewChat,
  });

  const searchField = (
    <SidebarSearchField
      value={search.query}
      accessibilityLabel="Search conversations and messages"
      placement={wide ? "list-header" : "chrome"}
      inputRef={search.inputRef}
      onChangeText={search.setQuery}
      onClear={() => search.clear()}
    />
  );

  const chrome = (
    <SidebarChrome
      leading={wide ? <NavSwitcher active="messages" style={styles.navInline} /> : searchField}
      actions={
        <>
          <SuggestionSettingsButton wide={wide} />
          <Pressable
            ref={filterBtnRef}
            accessibilityRole="button"
            accessibilityLabel="Filter conversations"
            onPress={openFilters}
            style={({ pressed }) => [chromeStyles.actionButton, pressed && { opacity: 0.55 }]}
          >
            <Ionicons name="options-outline" size={21} color={theme.accent} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New message"
            onPress={onNewMessage}
            style={({ pressed }) => [chromeStyles.actionButton, pressed && { opacity: 0.55 }]}
          >
            <Ionicons name="create-outline" size={23} color={theme.accent} />
          </Pressable>
        </>
      }
    />
  );

  return (
    <SidebarFrame chrome={chrome} thumb={<SyntheticScrollThumb state={viewport.thumb} />}>
      {/* Everything scrolls together — search, filters, and priority shelf ride
          along as the list's header, passing behind the glass top bar. */}
      <FlashList
          ref={viewport.listRef}
          data={model.listChats}
          keyExtractor={(chat) => chat.guid}
          maintainVisibleContentPosition={{ disabled: false }}
          keyboardShouldPersistTaps="handled"
          // Native-only: RNW's on-drag treats ANY scroll event as a drag and
          // BLURS the focused input — our scroll-to-top on keystroke was
          // killing search focus (the caught-in-the-act bug).
          keyboardDismissMode={Platform.OS === "web" ? "none" : "on-drag"}
          viewabilityConfig={viewport.viewabilityConfig}
          onViewableItemsChanged={viewport.onViewableItemsChanged}
          contentContainerStyle={{ paddingTop: topBarH + 8 }}
          automaticallyAdjustContentInsets={iosMobile ? false : undefined}
          automaticallyAdjustsScrollIndicatorInsets={iosMobile ? false : undefined}
          contentInsetAdjustmentBehavior={iosMobile ? "never" : undefined}
          showsVerticalScrollIndicator={false}
          onLayout={(e) => viewport.onLayout(e.nativeEvent.layout.height)}
          onScroll={viewport.onScroll}
          scrollEventThrottle={16}
          ListHeaderComponent={
            <View style={wide ? { paddingBottom: 6 } : null}>
              {wide && searchField}
              <ConversationFilters
                compact={wide}
                filters={filters}
                counts={counts}
                // Picking a badge exits search — the two never compose.
                onFiltersChange={(f) => search.applyFilters(f)}
              />
              {model.showPriorityShelf && (
                <PriorityShelf
                  ref={shelfRef}
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
      <ConversationFiltersModal
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        anchor={filterAnchor}
        filters={filters}
        counts={counts}
        onFiltersChange={onFiltersChange}
      />
    </SidebarFrame>
  );
}

const styles = StyleSheet.create({
  navInline: {
    flex: 1,
    marginBottom: 0,
    marginHorizontal: 0,
    marginTop: 0,
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
  empty: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 36,
  },
  emptyText: {
    fontSize: 15,
  },
});
