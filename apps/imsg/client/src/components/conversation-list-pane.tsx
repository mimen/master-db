import type { ChatSummary, StateCounts } from "@shared/types";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";


import { disambiguators } from "@shared/address";
import { ChatRow } from "./chat-row";
import { ConversationFiltersPanel, FilterChipRow, LensTabs } from "./conversation-filters";
import { useSignal } from "./conversations/signal";
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
import { commaApi } from "@/lib/convex-api";
import {
  activeChips,
  checkboxCounts,
  DEFAULT_INBOX_FILTERS,
  DEFAULT_REFINEMENTS,
  deriveInboxModel,
  filterInbox,
  LENSES,
  lensOf,
  tagsInUse,
  viewName,
  type InboxFilters,
  type InboxRow,
  type Lens,
  type Refinements,
} from "@/lib/inbox-model";
import {
  deleteView,
  hydrateInboxFilters,
  inboxFilterSnapshot,
  lensFilters,
  saveView,
  setLensFilters,
  subscribeInboxFilters,
  takePendingView,
  type SavedView,
} from "@/lib/palette/saved-views";
import { sidebarChromeHeight } from "@/lib/sidebar-metrics";
import { isListMode, subscribeListMode } from "@/lib/keyboard/controller";
import { useSyncExternalStore } from "react";

function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// FlashList 2 RecyclerView commitLayout increments internal state until
// measured item sizes settle. On RN-web they don't (fractional flex + chrome
// header) — that's React #185 in commitLayout, stack pointing at FlashList
// inside ConversationListPane. Contacts already uses FlatList for this reason.
const ConversationScrollList = Platform.OS === "web" ? FlatList : FlashList;
const PENDING_SCHEDULED = new Set(["pending", "in-progress"]);

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
  /** Round 4 has no Sweep entry in the sidebar; kept until messages-workspace drops it. */
  onStartSweep?: (chats: ChatSummary[], startGuid?: string) => void;
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
}: ConversationListPaneProps) {
  const theme = useTheme();
  const type = useType();
  const iosMobile = Platform.OS === "ios" && !wide;
  const search = useConversationSearch({ filters, onFiltersChange });
  const signal = useSignal();
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const store = useSyncExternalStore(subscribeInboxFilters, inboxFilterSnapshot, inboxFilterSnapshot);
  useEffect(() => { void hydrateInboxFilters(); }, []);
  // Refinements belong to the lens; People is the workspace's type lens, remembered per lens too.
  const refinements: Refinements = store.byLens[filters.state]?.refinements ?? DEFAULT_REFINEMENTS;
  const setRefinements = useCallback((next: Refinements) => {
    setLensFilters(filters.state, { type: filters.type, refinements: next });
  }, [filters.state, filters.type]);
  const setType = useCallback((type: InboxFilters["type"]) => {
    setLensFilters(filters.state, { type, refinements });
    onFiltersChange({ ...filters, type });
  }, [filters, refinements, onFiltersChange]);
  const selectLens = useCallback((lens: InboxFilters["state"]) => {
    const remembered = lensFilters(lens, DEFAULT_INBOX_FILTERS.type);
    search.applyFilters({ state: lens, type: remembered.type });
  }, [search]);
  const openView = useCallback((view: SavedView) => {
    setLensFilters(view.state, { type: view.type, refinements: view.refinements });
    search.applyFilters({ state: view.state, type: view.type });
  }, [search]);
  // The palette's "Open <view>" lands here.
  useEffect(() => {
    if (store.pending) {
      const view = takePendingView();
      if (view) openView(view);
    }
  }, [store.pending, openView]);
  // ⌘1..⌘4 switch lenses. Editable-safe: a chord never types.
  useEffect(() => {
    if (Platform.OS !== "web" || !wide) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const lens = LENSES[Number(event.key) - 1];
      if (!lens) return;
      event.preventDefault();
      selectLens(lens.value);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [wide, selectLens]);
  const scheduledRows = useQuery(commaApi.listScheduled, {});
  const scheduled = useMemo(() => new Set((scheduledRows ?? [])
    .filter((row) => PENDING_SCHEDULED.has(row.status))
    .flatMap((row) => [row.chatGuid, ...(row.conversationId ? [row.conversationId] : [])])), [scheduledRows]);
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
  // Minute resolution: ages and the Today / This week boundary move with it.
  const now = useMinuteClock();
  const refine = useMemo(() => ({ refinements, scheduled, now }), [refinements, scheduled, now]);
  // Explicitly memoised: full passes over every conversation, plus a per-chat
  // participant scan while searching.
  const deskModel = useMemo(
    () => deriveInboxModel(allChats, filters, search.query, search.deepMatches, browseGuids, refine),
    [allChats, filters, search.query, search.deepMatches, browseGuids, refine],
  );
  const lensTotal = useMemo(() => filterInbox(allChats, filters, "", undefined, browseGuids).length, [allChats, filters, browseGuids]);
  const toggleCounts = useMemo(() => checkboxCounts(allChats, filters, browseGuids, refine), [allChats, filters, browseGuids, refine]);
  const tags = useMemo(() => tagsInUse(allChats), [allChats]);
  const chips = activeChips(filters, refinements);
  const lensLabel = LENSES.find((lens) => lens.value === filters.state)?.label ?? "Settled";
  const clearAll = useCallback(() => {
    setLensFilters(filters.state, { type: DEFAULT_INBOX_FILTERS.type, refinements: DEFAULT_REFINEMENTS });
    onFiltersChange({ ...filters, type: DEFAULT_INBOX_FILTERS.type });
  }, [filters, onFiltersChange]);
  const removeChip = useCallback((chip: (typeof chips)[number]) => {
    const next = chip.remove(filters, refinements);
    setLensFilters(filters.state, { type: next.filters.type, refinements: next.refinements });
    if (next.filters.type !== filters.type) onFiltersChange(next.filters);
  }, [filters, refinements, onFiltersChange]);
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
  const renderChat = useCallback(
    (item: ChatSummary) => (
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
  const renderRow = useCallback(
    ({ item: row }: { item: InboxRow }) => row.kind === "section" ? (
      <View style={styles.group}>
        <Text accessibilityRole="header" style={[styles.groupLabel, { color: signal.textTertiary }]}>{row.label}</Text>
        <Text style={[styles.groupCount, { color: signal.textTertiary }]}>{row.count}</Text>
      </View>
    ) : renderChat(row.chat),
    [signal, renderChat],
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
    <View>
      <ChromeIconButton
        ref={filterBtnRef}
        icon={chips.length > 0 ? "filter" : "filter-outline"}
        color={chips.length > 0 ? signal.text : undefined}
        accessibilityLabel={chips.length > 0 ? `Filter conversations, ${chips.length} active` : "Filter conversations"}
        onPress={openFilters}
      />
      {chips.length > 0 ? (
        <View pointerEvents="none" style={[styles.badge, { backgroundColor: signal.text, borderColor: signal.popBg }]}>
          <Text style={[styles.badgeText, { color: signal.popBg }]}>{chips.length}</Text>
        </View>
      ) : null}
    </View>
  );
  const lensTabs = (
    <LensTabs state={filters.state} counts={counts} onSelect={(lens: Lens) => selectLens(lens)} phone={!wide} />
  );
  const chrome = wide ? (
    <TriageQueueHeader
      search={searchField}
      action={<>{filterButton}<ChromeIconButton hugeIcon={SquarePenIcon} accessibilityLabel="New message" onPress={onNewMessage} /></>}
      controls={lensTabs}
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
          data={deskModel.rows}
          keyExtractor={(row) => row.key}
          {...(Platform.OS === "web" ? {} : { getItemType: (row: InboxRow) => row.kind })}
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
              {!wide && <View style={styles.phoneTabs}>{lensTabs}</View>}
              {lensOf(filters.state) === null && !search.active ? (
                <Text style={[styles.lensNote, { color: signal.textSecondary, fontSize: type.secondary }]}>Settled</Text>
              ) : null}
              {!search.active ? (
                <FilterChipRow
                  chips={chips}
                  views={store.views}
                  phone={!wide}
                  countLine={`${deskModel.listChats.length} of ${lensTotal} match`}
                  onRemove={removeChip}
                  onClearAll={clearAll}
                  onOpenView={openView}
                  onDeleteView={(view) => deleteView(view.id)}
                />
              ) : null}
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
      <ConversationFiltersPanel
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        anchor={filterAnchor}
        type={filters.type}
        refinements={refinements}
        onTypeChange={setType}
        onRefinementsChange={setRefinements}
        onClearAll={clearAll}
        onSaveView={() => saveView({ name: viewName(filters, refinements), state: filters.state, type: filters.type, refinements })}
        tags={tags}
        counts={toggleCounts}
        showing={deskModel.listChats.length}
        total={lensTotal}
        lensLabel={lensLabel}
      />
    </SidebarFrame>
  );
  return pane;
}

const styles = StyleSheet.create({
  offlineBar: { alignItems: "center", borderRadius: 8, flexDirection: "row", gap: 6, marginHorizontal: 12, marginVertical: 6, paddingHorizontal: 10, paddingVertical: 5 },
  offlineText: { flex: 1, fontSize: 12, minWidth: 0 },
  phoneTabs: { paddingTop: 4 },
  lensNote: { fontWeight: "600", paddingHorizontal: 18, paddingTop: 10 },
  group: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 6, paddingHorizontal: 18, paddingTop: 14 },
  groupLabel: { fontSize: 11.5 },
  groupCount: { fontSize: 11.5, fontVariant: ["tabular-nums"] },
  badge: { alignItems: "center", borderRadius: 8, borderWidth: 1.5, height: 16, justifyContent: "center", minWidth: 16, paddingHorizontal: 3, position: "absolute", right: -3, top: -3 },
  badgeText: { fontSize: 10, fontVariant: ["tabular-nums"], fontWeight: "700" },
  empty: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 36,
  },
  emptyText: {
    fontSize: 15,
  },
});
