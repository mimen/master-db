import type { ChatSummary, StateCounts } from "@shared/types";
import { useCallback, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";


import { ChatRow } from "./chat-row";
import { ConversationFilters, ConversationFiltersModal, type FilterAnchor } from "./conversation-filters";
import { NavSwitcher } from "./nav-switcher";
import { PriorityShelf, type PriorityShelfHandle } from "./priority-shelf";
import { SkeletonList } from "./skeleton-list";

import { ChromeIconButton } from "./sidebar/chrome-icon-button";
import { SettingsButton } from "./sidebar/settings-button";
import { SidebarChrome } from "./sidebar/sidebar-chrome";
import { SidebarFrame } from "./sidebar/sidebar-frame";
import { SidebarSearchField } from "./sidebar/sidebar-search-field";
import { SyntheticScrollThumb } from "./sidebar/synthetic-scroll-thumb";
import { useConversationListKeyboard } from "./conversations/use-conversation-list-keyboard";
import { useConversationListViewport } from "./conversations/use-conversation-list-viewport";
import { useConversationSearch } from "./conversations/use-conversation-search";

import { useChatActions } from "@/hooks/use-chat-actions";
import { useTheme } from "@/hooks/use-theme";
import { useType } from "@/hooks/use-type";
import { deriveInboxModel, type InboxFilters } from "@/lib/inbox-model";
import { sidebarChromeHeight } from "@/lib/sidebar-metrics";
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
  const type = useType();
  const { openMenu } = useChatActions();
  const iosMobile = Platform.OS === "ios" && !wide;
  const search = useConversationSearch({ filters, onFiltersChange });
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState<FilterAnchor | null>(null);
  const topBarH = sidebarChromeHeight(wide);
  const filterBtnRef = useRef<View>(null);

  // Desktop opens filters as a popover mounted at the button; mobile as a sheet.
  // useCallback, not a bare arrow: the compiler can't prove a render-scope
  // function that touches a ref is never called during render, and bails.
  const openFilters = useCallback((): void => {
    if (wide && filterBtnRef.current) {
      filterBtnRef.current.measureInWindow((x, y, width, height) => {
        setFilterAnchor({ x, y, width, height });
        setFilterOpen(true);
      });
    } else {
      setFilterAnchor(null);
      setFilterOpen(true);
    }
  }, [wide]);
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
  // Explicitly memoised rather than left to the compiler: this is four full
  // passes over every conversation plus a per-chat participant scan while
  // searching, and it used to re-run on every render of this pane.
  const model = useMemo(
    () => deriveInboxModel(allChats, filters, search.query, search.deepMatches, browseGuids),
    [allChats, filters, search.query, search.deepMatches, browseGuids],
  );
  const glide = useSyncExternalStore(subscribeListMode, isListMode, () => false);

  // All imperative list scrolling (glide pinning, view resets, reorder
  // recovery) and the synthetic thumb live in the viewport hook.
  const viewport = useConversationListViewport({
    renderedChats: model.listChats,
    chromeHeight: topBarH,
    viewKey: search.viewKey,
  });
  // FlashList's cell memo compares renderItem by identity, so a fresh arrow here
  // re-renders every mounted row on every render of this pane.
  const renderRow = useCallback(
    ({ item }: { item: ChatSummary }) => (
      <ChatRow
        chat={item}
        selected={wide && selectedGuid === item.guid}
        keyboardFocused={wide && glide && selectedGuid === item.guid}
        onPress={() => onOpenChat(item)}
      />
    ),
    [wide, glide, selectedGuid, onOpenChat],
  );

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
      placement="chrome"
      inputRef={search.inputRef}
      onChangeText={search.setQuery}
      onClear={() => search.clear()}
    />
  );

  const chrome = (
    <SidebarChrome
      leading={wide ? null : searchField}
      toolbar={wide ? searchField : undefined}
      titleAccessory={wide ? <NavSwitcher active="messages" /> : undefined}
      actions={
        <>
          <SettingsButton />
          <ChromeIconButton
            ref={filterBtnRef}
            icon="options-outline"
            accessibilityLabel="Filter conversations"
            onPress={openFilters}
          />
          <ChromeIconButton
            icon="create-outline"
            accessibilityLabel="New message"
            onPress={onNewMessage}
          />
        </>
      }
    />
  );

  return (
    <SidebarFrame chrome={chrome} thumb={<SyntheticScrollThumb state={viewport.thumb} />}>
      {/* Filters and the labeled shelf ride the list header, passing
          behind the glass top bar. Wide search is sticky chrome. */}
      <FlashList
          ref={viewport.listRef}
          data={model.listChats}
          keyExtractor={(chat) => chat.guid}
          // Default iOS draw distance is 250px — barely three rows here, so a fast
          // flick outruns it and shows blanks.
          drawDistance={1500}
          keyboardShouldPersistTaps="handled"
          // Native-only: RNW's on-drag treats ANY scroll event as a drag and
          // BLURS the focused input — our scroll-to-top on keystroke was
          // killing search focus (the caught-in-the-act bug).
          keyboardDismissMode={Platform.OS === "web" ? "none" : "on-drag"}
          viewabilityConfig={viewport.viewabilityConfig}
          onViewableItemsChanged={viewport.onViewableItemsChanged}
          contentContainerStyle={{ paddingTop: Platform.OS === "web" ? 0 : topBarH + 8 }}
          automaticallyAdjustContentInsets={iosMobile ? false : undefined}
          automaticallyAdjustsScrollIndicatorInsets={iosMobile ? false : undefined}
          contentInsetAdjustmentBehavior={iosMobile ? "never" : undefined}
          showsVerticalScrollIndicator={false}
          onLayout={(e) => viewport.onLayout(e.nativeEvent.layout.height)}
          onScroll={viewport.onScroll}
          scrollEventThrottle={16}
          ListHeaderComponent={
            <View
              style={{
                // FlashList on web drops contentContainerStyle paddingTop; the
                // header has to own the chrome offset or search sits under the bar.
                paddingTop: Platform.OS === "web" ? topBarH + 8 : 0,
                paddingBottom: wide ? 6 : 0,
              }}
            >
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
              {/* Default "Recent" needs no label. Wide already names the
                  view via the filter chips — don't stack a second heading. */}
              {!wide && model.sectionLabel !== "Recent" && (
                <View style={styles.sectionHeading}>
                  <Text style={[styles.sectionTitle, { color: theme.text, fontSize: type.title }]}>{model.sectionLabel}</Text>
                  <Text style={[styles.sectionCount, { color: theme.textSecondary, fontSize: type.secondary }]}>{model.sectionCount}</Text>
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
          renderItem={renderRow}
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
