import type { ChatSummary, StateCounts } from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";


import { disambiguators } from "@shared/address";
import { ChatRow } from "./chat-row";
import { ConversationFiltersModal, StateSegments, type FilterAnchor } from "./conversation-filters";
import { SkeletonList } from "./skeleton-list";
import { TriageQueueHeader, TRIAGE_QUEUE_HEADER_HEIGHT } from "./triage-queue-header";

import { ChromeIconButton } from "./sidebar/chrome-icon-button";
import SquarePenIcon from "@hugeicons/core-free-icons/SquarePenIcon";
import { SettingsButton } from "./sidebar/settings-button";
import { SidebarChrome } from "./sidebar/sidebar-chrome";
import { SidebarFrame } from "./sidebar/sidebar-frame";
import { SidebarSearchField } from "./sidebar/sidebar-search-field";
import { SyntheticScrollThumb } from "./sidebar/synthetic-scroll-thumb";
import { useConversationListKeyboard } from "./conversations/use-conversation-list-keyboard";
import { useConversationListViewport } from "./conversations/use-conversation-list-viewport";
import { useConversationSearch } from "./conversations/use-conversation-search";

import { onTriageResolved, onTriageUndo, toggleSettleChat } from "@/hooks/use-triage-actions";
import { useTheme } from "@/hooks/use-theme";
import { useType } from "@/hooks/use-type";
import { deriveInboxModel, desktopInboxTitle, type InboxFilters } from "@/lib/inbox-model";
import { sidebarChromeHeight } from "@/lib/sidebar-metrics";
import { isListMode, subscribeListMode } from "@/lib/keyboard/controller";
import { useSyncExternalStore } from "react";

// FlashList 2 RecyclerView commitLayout increments internal state until
// measured item sizes settle. On RN-web they don't (fractional flex + chrome
// header) — that's React #185 in commitLayout, stack pointing at FlashList
// inside ConversationListPane. Contacts already uses FlatList for this reason.
const ConversationScrollList = Platform.OS === "web" ? FlatList : FlashList;
const SEGMENT_LABELS = new Set(["Needs reply", "Waiting"]);

interface ConversationListPaneProps {
  chats: ChatSummary[];
  /** Unfiltered universe — what search mode searches. */
  allChats: ChatSummary[];
  counts: StateCounts | null;
  filters: InboxFilters;
  loading: boolean;
  /** The last chat-list fetch failed; the list is the saved copy. */
  offline: boolean;
  wide: boolean;
  selectedGuid?: string;
  onFiltersChange: (filters: InboxFilters) => void;
  onOpenChat: (chat: ChatSummary) => void;
  /** Glide-mode j/k selection: show the thread without focusing or marking
   * read. Required — keyboard moves must never fall back to opening. */
  onPreviewChat: (chat: ChatSummary) => void;
  onRefresh: () => void;
  onNewMessage: () => void;
  onStartSweep: (chats: ChatSummary[], startGuid?: string) => void;
}

export function ConversationListPane({
  chats,
  allChats,
  counts,
  filters,
  loading,
  offline,
  wide,
  selectedGuid,
  onFiltersChange,
  onOpenChat,
  onPreviewChat,
  onRefresh,
  onNewMessage,
  onStartSweep,
}: ConversationListPaneProps) {
  const theme = useTheme();
  const type = useType();
  const iosMobile = Platform.OS === "ios" && !wide;
  const search = useConversationSearch({ filters, onFiltersChange });
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState<FilterAnchor | null>(null);
  useEffect(() => {
    const stopResolved = onTriageResolved(onRefresh);
    const stopUndo = onTriageUndo(onRefresh);
    return () => {
      stopResolved();
      stopUndo();
    };
  }, [onRefresh]);
  const topBarH = wide ? TRIAGE_QUEUE_HEADER_HEIGHT : sidebarChromeHeight(false);
  const filterBtnRef = useRef<View>(null);
  const selectedPositionRef = useRef<{ guid: string; index: number } | null>(null);
  const deskTitle = desktopInboxTitle(filters);

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
  // Search is a MODE, not a compound filter: typing searches the FULL
  // universe, superseding the badge filters; clearing the query
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
  const deskChats = useMemo(() => {
    return [...model.listChats].sort((a, b) => {
      const aRank = a.flags.pinned ? 0 : a.crm?.priority !== undefined && a.crm.priority <= 2 ? 1 : 2;
      const bRank = b.flags.pinned ? 0 : b.crm?.priority !== undefined && b.crm.priority <= 2 ? 1 : 2;
      if (aRank !== bRank) return aRank - bRank;
      return (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0);
    });
  }, [model.listChats]);
  const deskModel = useMemo(() => wide ? ({
    ...model,
    listChats: deskChats,
    navigationEntries: deskChats.map((chat, index) => ({ chat, index })),
  }) : model, [model, deskChats, wide]);
  const sweepableChats = useMemo(
    () => deskModel.listChats.filter((chat) => chat.flags.unresponded),
    [deskModel.listChats],
  );
  const glide = useSyncExternalStore(subscribeListMode, isListMode, () => false);

  // All imperative list scrolling (glide pinning, view resets, reorder
  // recovery) and the synthetic thumb live in the viewport hook.
  const viewport = useConversationListViewport({
    renderedChats: deskModel.listChats,
    chromeHeight: topBarH,
    viewKey: search.viewKey,
  });
  useEffect(() => {
    if (!wide || !selectedGuid) { selectedPositionRef.current = null; return; }
    const selectedIndex = deskModel.listChats.findIndex((chat) => chat.guid === selectedGuid);
    const prior = selectedPositionRef.current;
    selectedPositionRef.current = { guid: selectedGuid, index: selectedIndex };
    if (prior?.guid !== selectedGuid || prior.index <= 0 || selectedIndex !== 0) return;
    requestAnimationFrame(() => viewport.listRef.current?.scrollToOffset({ offset: 0, animated: false }));
  }, [deskModel.listChats, selectedGuid, viewport.listRef, wide]);

  // FlashList's cell memo compares renderItem by identity, so a fresh arrow here
  // re-renders every mounted row on every render of this pane.
  // One person's second number or email reads as a duplicate row without its handle.
  const handles = useMemo(() => disambiguators(allChats), [allChats]);
  const renderRow = useCallback(
    ({ item }: { item: ChatSummary }) => (
      <ChatRow
        chat={item}
        handle={handles.get(item.guid)}
        selected={wide && selectedGuid === item.guid}
        keyboardFocused={wide && glide && selectedGuid === item.guid}
        onPress={() => onOpenChat(item)}
        // Offered on every lens and every width. The row reads the
        // conversation's own state to decide settle vs un-settle, and the
        // gesture toasts whatever it did.
        onSettle={() => { void toggleSettleChat(item); }}
      />
    ),
    [wide, glide, selectedGuid, onOpenChat, handles],
  );

  useConversationListKeyboard({
    enabled: wide,
    model: deskModel,
    selectedGuid,
    viewport,
    search,
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

  const filterButton = (
    <ChromeIconButton ref={filterBtnRef} icon="options-outline" accessibilityLabel="Filter conversations" onPress={openFilters} />
  );
  const chrome = wide ? (
    <TriageQueueHeader
      title={deskTitle}
      sweepCount={sweepableChats.length}
      search={searchField}
      action={<>{filterButton}<ChromeIconButton hugeIcon={SquarePenIcon} accessibilityLabel="New message" onPress={onNewMessage} /></>}
      controls={<StateSegments filters={filters} counts={counts} onFiltersChange={(f) => search.applyFilters(f)} />}
      onSweep={filters.state === "unresponded" ? () => { if (sweepableChats.length) onStartSweep(sweepableChats, sweepableChats.some((chat) => chat.guid === selectedGuid) ? selectedGuid : sweepableChats[0]?.guid); } : undefined}
    />
  ) : (
    <SidebarChrome
      leading={searchField}
      actions={
        <>
          <SettingsButton />
          {filterButton}
          <ChromeIconButton hugeIcon={SquarePenIcon} accessibilityLabel="New message" onPress={onNewMessage} />
        </>
      }
    />
  );

  const pane = (
    <SidebarFrame
      chrome={chrome}
      chromeHeight={topBarH}
      thumb={<SyntheticScrollThumb state={viewport.thumb} />}
    >
      {/* Filters ride the list header, passing behind the glass top bar.
          Wide search is sticky chrome. */}
      <ConversationScrollList
          testID="conversation-list-scroll"
          // FlashListRef and FlatList's ref don't overlap; callers only use
          // scrollToOffset / scrollToIndex (ConversationListHandle).
          ref={viewport.listRef as never}
          data={deskModel.listChats}
          keyExtractor={(chat) => chat.conversationId ?? chat.guid}
          // Native-only: FlatList has no drawDistance, and FlashList's is what
          // keeps a fast iOS flick from showing blanks (default is 250px).
          {...(Platform.OS === "web" ? {} : { drawDistance: 1500 })}
          keyboardShouldPersistTaps="handled"
          // Native-only: RNW's on-drag treats ANY scroll event as a drag and
          // BLURS the focused input — our scroll-to-top on keystroke was
          // killing search focus (the caught-in-the-act bug).
          keyboardDismissMode={Platform.OS === "web" ? "none" : "on-drag"}
          viewabilityConfig={viewport.viewabilityConfig}
          onViewableItemsChanged={viewport.onViewableItemsChanged}
          contentContainerStyle={{
            paddingTop: Platform.OS === "web" ? 0 : topBarH,
            paddingBottom: 12,
            paddingHorizontal: 0,
          }}
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
                paddingTop: Platform.OS === "web" ? topBarH : 0,
              }}
            >
              {/* Mounted empty so a screen reader announces the text when it arrives. */}
              <View role="status" aria-live="polite">
                {offline && (
                  <View testID="offline-bar" style={[styles.offlineBar, { backgroundColor: theme.backgroundElement }]}>
                    <Ionicons aria-hidden name="cloud-offline-outline" size={13} color={theme.textSecondary} />
                    <Text style={[styles.offlineText, { color: theme.textSecondary }]}>{allChats.length > 0 ? "Offline. Messages send when you reconnect." : "Offline. Reconnecting…"}</Text>
                  </View>
                )}
              </View>
              {!wide && (
                <View style={styles.phoneSegments}>
                  <StateSegments filters={filters} counts={counts} onFiltersChange={(f) => search.applyFilters(f)} />
                </View>
              )}
              {/* Name the view only when the segments can't: a menu-only
                  state or a type lens. Wide names it in the header title. */}
              {!wide && model.sectionLabel !== "Recent" && !SEGMENT_LABELS.has(model.sectionLabel) && (
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
  return pane;
}

const styles = StyleSheet.create({
  offlineBar: { alignItems: "center", borderRadius: 8, flexDirection: "row", gap: 6, marginHorizontal: 12, marginVertical: 6, paddingHorizontal: 10, paddingVertical: 5 },
  offlineText: { flex: 1, fontSize: 12, minWidth: 0 },
  phoneSegments: { paddingBottom: 4, paddingHorizontal: 16, paddingTop: 4 },
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
