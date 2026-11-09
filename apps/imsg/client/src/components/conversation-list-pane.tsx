import type { ChatSummary, ConversationId, StateCounts } from "@shared/types";
import { useConvexAuth, useQuery } from "convex/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { FlashList } from "@shopify/flash-list";


import { disambiguators, type HandleTiebreak } from "@shared/address";
import { TODAY_SETTLE_GROUP } from "@shared/today";
import { ChatRow } from "./chat-row";
import { FilterChipRow, LensTabs } from "./conversation-filters";
import { ConversationFiltersPanel } from "./lazy-surfaces";
import { EmptyLens } from "./empty-lens";
import { Collapse } from "./motion/collapse";
import { SkeletonList } from "./skeleton-list";

import Menu08Icon from "@hugeicons/core-free-icons/Menu08Icon";
import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon";
import { ChromeIconButton } from "./sidebar/chrome-icon-button";
import { SidebarChrome } from "./sidebar/sidebar-chrome";
import { SidebarFooter } from "./sidebar/sidebar-footer";
import { SidebarFrame } from "./sidebar/sidebar-frame";
import { SidebarHeader } from "./sidebar/sidebar-header";
import { SidebarSearchField } from "./sidebar/sidebar-search-field";
import { SyntheticScrollThumb } from "./sidebar/synthetic-scroll-thumb";
import { useConversationListKeyboard } from "./conversations/use-conversation-list-keyboard";
import { type ConversationListHandle, useConversationListViewport } from "./conversations/use-conversation-list-viewport";
import { useConversationSearch } from "./conversations/use-conversation-search";
import { PHONE_TAB_BAR_CLEARANCE } from "./phone-tab-bar";
import { TriageGeometry } from "@/constants/triage-theme";

import { publishRenderedOrder } from "@/hooks/use-queue-position";
import { onTriageResolved, onTriageUndo, settleAllChats } from "@/hooks/use-triage-actions";
import { useTheme } from "@/hooks/use-theme";
import { useToday } from "@/hooks/use-today";
import { useAppBadge } from "@/lib/app-badge";
import { useType } from "@/hooks/use-type";
import { accountsApi, commaApi } from "@/lib/convex-api";
import { usePendingScheduled } from "@/lib/pending-scheduled";
import {
  activeChips,
  checkboxCounts,
  DEFAULT_INBOX_FILTERS,
  DEFAULT_REFINEMENTS,
  deriveInboxModel,
  desktopInboxTitle,
  filterInbox,
  LENSES,
  lensOf,
  narrowToday,
  platformsInUse,
  tagsInUse,
  planChats,
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
import { SIDEBAR_TITLE_HEIGHT } from "@/lib/sidebar-metrics";
import { planToday, settleAllTargets, todayHeader, type TodaySectionKey } from "@/lib/today";
import { InfoTip, TodayHeaderCard } from "./today-header";
import { isListMode, requestFocus, subscribeListMode } from "@/lib/keyboard/controller";
import { nextLeaving, withLeaving, type LeavingRow } from "@/lib/leaving-rows";
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
const rowKey = (row: InboxRow): string => row.key;

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
  selectedId?: ConversationId;
  /** The open conversation the workspace keeps in its slot after it is handled (desktop). */
  held?: ConversationId | null;
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
  offline,
  wide,
  selectedId,
  held = null,
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
  // ⌘1..⌘7 switch lenses. Editable-safe: a chord never types.
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
  // The "Has a scheduled message" refinement drops a cancelled or sent row on the tap, like the footer count.
  const scheduledRows = usePendingScheduled(useQuery(commaApi.listScheduled, {}));
  const scheduled = useMemo(() => new Set((scheduledRows ?? [])
    .filter((row) => PENDING_SCHEDULED.has(row.status))
    .flatMap((row) => (row.conversationId ? [row.conversationId] : []))), [scheduledRows]);
  useEffect(() => {
    const stopResolved = onTriageResolved(onRefresh);
    const stopUndo = onTriageUndo(onRefresh);
    return () => {
      stopResolved();
      stopUndo();
    };
  }, [onRefresh]);
  // Wide chrome sits in the flow above the list; the phone bar floats over it.
  const topBarH = wide ? 0 : SIDEBAR_TITLE_HEIGHT;
  const filterBtnRef = useRef<View>(null);
  const selectedPositionRef = useRef<{ conversationId: ConversationId; index: number } | null>(null);

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
  const browseIds = useMemo(() => new Set(chats.map((c) => c.conversationId)), [chats]);
  // Minute resolution: ages and the Today / This week boundary move with it.
  const now = useMinuteClock();
  const refine = useMemo(() => ({ refinements, scheduled, now }), [refinements, scheduled, now]);
  // Today's plan runs on every lens: it is also the Today tab's count.
  const today = useToday();
  // The section the held row sat in when the hold began, so a reply cannot drop it out of New since or Below the line.
  const [heldAt, setHeldAt] = useState<{ conversationId: ConversationId; section: TodaySectionKey | undefined } | null>(null);
  const heldSection = heldAt?.conversationId === held ? heldAt.section : undefined;
  const todayChats = useMemo(() => (today.mail.length ? [...allChats, ...today.mail] : allChats), [allChats, today.mail]);
  const plan = useMemo(() => planToday(today.view, todayChats, { held, heldSection }), [today.view, todayChats, held, heldSection]);
  // What Today lists and Settle all reaches, under the filters. The tab, the badge and the header count the whole plan.
  const shownPlan = useMemo(() => narrowToday(plan, filters.type, refine), [plan, filters.type, refine]);
  if ((heldAt?.conversationId ?? null) !== held) {
    setHeldAt(held === null ? null : { conversationId: held, section: plan.sections.find((section) => section.rows.some((row) => row.chat.conversationId === held))?.key });
  }
  const [openFolds, setOpenFolds] = useState<ReadonlySet<TodaySectionKey>>(() => new Set());
  const toggleFold = useCallback((key: TodaySectionKey) => setOpenFolds((current) => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    return next;
  }), []);
  const planRef = useRef({ plan: shownPlan, view: today.view });
  useEffect(() => { planRef.current = { plan: shownPlan, view: today.view }; });
  const settleSection = useCallback((key: TodaySectionKey) => {
    const { plan: current, view } = planRef.current;
    const section = current.sections.find((candidate) => candidate.key === key);
    if (section) void settleAllChats(settleAllTargets(view, section.rows.map((row) => row.chat)));
  }, []);
  const onToday = filters.state === "today";
  const lensCounts = useMemo(() => (counts ? { ...counts, today: plan.toGo } : null), [counts, plan.toGo]);
  useAppBadge(today.view === undefined ? undefined : plan.toGo);
  // Explicitly memoised: full passes over every conversation, plus a per-chat
  // participant scan while searching.
  const deskModel = useMemo(
    () => deriveInboxModel(allChats, filters, search.query, search.deepMatches, browseIds, refine, onToday ? { plan: shownPlan, openFolds } : undefined),
    [allChats, filters, search.query, search.deepMatches, browseIds, refine, onToday, shownPlan, openFolds],
  );
  // Today's rows count folded sections too; the other lenses count what their filter lets through.
  const todayRows = useMemo(() => planChats(plan), [plan]);
  const lensTotal = useMemo(() => onToday ? todayRows.length : filterInbox(allChats, filters, "", undefined, browseIds).length, [onToday, todayRows, allChats, filters, browseIds]);
  const lensShowing = onToday ? planChats(shownPlan).length : deskModel.listChats.length;
  const toggleCounts = useMemo(
    () => onToday ? checkboxCounts(todayRows, { ...filters, state: "all" }, undefined, refine) : checkboxCounts(allChats, filters, browseIds, refine),
    [onToday, todayRows, allChats, filters, browseIds, refine],
  );
  const tags = useMemo(() => tagsInUse(allChats), [allChats]);
  // Today lists mail beside the messages, so its Service menu offers Gmail.
  const platforms = useMemo(() => platformsInUse(onToday ? todayChats : allChats), [onToday, todayChats, allChats]);
  const { isAuthenticated } = useConvexAuth();
  const accounts = useQuery(accountsApi.listAccounts, isAuthenticated ? {} : "skip");
  const personalMail = useMemo(() => new Set((accounts ?? []).flatMap((account) => account.gmailApp === "personal" ? [account._id as string] : [])), [accounts]);
  // Today ignores Sort and Also include, so their chips would claim a filter that isn't there.
  const chips = activeChips(filters, refinements).filter((chip) => !onToday || !(chip.key === "order" || chip.key.startsWith("include-")));
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

  // A row that leaves the view (settle, swipe, a reply landing) stays in its slot and collapses
  // on smooth while the rows below close the gap. Switching lens or query cuts as before.
  // Tracked during render, not in an effect, so the row is never missing for a frame.
  // Section rows ride the same path, so an emptied age group folds away with its last row.
  const modelRows = deskModel.rows;
  const [seen, setSeen] = useState<{
    viewKey: string;
    rows: readonly InboxRow[];
    leaving: ReadonlyMap<string, LeavingRow<InboxRow>>;
  }>({ viewKey: search.viewKey, rows: modelRows, leaving: new Map() });
  if (seen.viewKey !== search.viewKey || seen.rows !== modelRows) {
    setSeen({
      viewKey: search.viewKey,
      rows: modelRows,
      leaving: seen.viewKey === search.viewKey ? nextLeaving(seen.rows, modelRows, seen.leaving, rowKey) : new Map(),
    });
  }
  const leaving = seen.leaving;
  const rows = useMemo(() => withLeaving(modelRows, leaving, rowKey), [modelRows, leaving]);
  // The thread's "2 of 41" and auto-advance read the order this list renders.
  useEffect(() => publishRenderedOrder(deskModel.listChats), [deskModel.listChats]);
  useEffect(() => () => publishRenderedOrder(null), []);
  const dropLeaving = useCallback((key: string): void => {
    setSeen((current) => {
      if (!current.leaving.has(key)) return current;
      const next = new Map(current.leaving);
      next.delete(key);
      return { ...current, leaving: next };
    });
  }, []);

  // All imperative list scrolling (glide pinning, view resets, reorder
  // recovery) and the synthetic thumb live in the viewport hook.
  const listRef = useRef<ConversationListHandle>(null);
  const viewport = useConversationListViewport({
    renderedChats: deskModel.listChats,
    chromeHeight: topBarH,
    viewKey: search.viewKey,
    listRef,
  });
  useEffect(() => {
    if (!wide || !selectedId) { selectedPositionRef.current = null; return; }
    const selectedIndex = deskModel.listChats.findIndex((chat) => chat.conversationId === selectedId);
    const prior = selectedPositionRef.current;
    selectedPositionRef.current = { conversationId: selectedId, index: selectedIndex };
    if (prior?.conversationId !== selectedId || prior.index <= 0 || selectedIndex !== 0) return;
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: false }));
  }, [deskModel.listChats, selectedId, wide]);

  // FlashList's cell memo compares renderItem by identity, so a fresh arrow here
  // re-renders every mounted row on every render of this pane.
  // One person's second number or email reads as a duplicate row without its handle.
  const handles = useMemo(() => disambiguators(allChats), [allChats]);
  // The parent's onOpenChat is a fresh function every render. A stable handle keeps ChatRow's
  // memo intact, so a click re-renders the two rows whose selection changed, not every row.
  const openChatRef = useRef(onOpenChat);
  useEffect(() => { openChatRef.current = onOpenChat; });
  const openRow = useCallback((chat: ChatSummary) => openChatRef.current(chat), []);
  const renderRow = useCallback(
    ({ item: row }: { item: InboxRow }) => (
      <InboxCell
        row={row}
        gone={leaving.has(row.key)}
        onCollapsed={dropLeaving}
        labelColor={theme.textTertiary}
        handle={row.kind === "chat" ? handles.get(row.chat.conversationId) : undefined}
        personal={row.kind === "chat" && row.chat.route.accountId !== null && personalMail.has(row.chat.route.accountId)}
        selected={row.kind === "chat" && wide && selectedId === row.chat.conversationId}
        keyboardFocused={row.kind === "chat" && wide && glide && selectedId === row.chat.conversationId}
        onOpen={openRow}
        agentLens={filters.state === "agents"}
        onToggleFold={toggleFold}
        onSettleAll={settleSection}
      />
    ),
    [theme.textTertiary, leaving, dropLeaving, handles, personalMail, wide, glide, selectedId, openRow, filters.state, toggleFold, settleSection],
  );
  // Needs you and Unread show what happened and the next step once they empty; other lenses
  // and searches keep the plain line.
  const emptyLens = !search.query && chips.length === 0 && (filters.state === "unresponded" || filters.state === "unread") ? filters.state : null;

  useConversationListKeyboard({
    enabled: wide,
    model: deskModel,
    selectedId,
    viewport,
    search,
    onOpenChat,
    onPreviewChat,
  });

  const searchField = (
    <SidebarSearchField
      value={search.query}
      accessibilityLabel="Search conversations and messages"
      inputRef={search.inputRef}
      onChangeText={search.setQuery}
      onClear={() => search.clear()}
      shortcut="⌘K"
    />
  );

  const filterButton = (
    <View>
      <ChromeIconButton
        ref={filterBtnRef}
        hugeIcon={Menu08Icon}
        accessibilityLabel={chips.length > 0 ? `Filter conversations, ${chips.length} active` : "Filter conversations"}
        onPress={openFilters}
      />
      {chips.length > 0 ? (
        <View pointerEvents="none" style={[styles.badge, { backgroundColor: theme.text, borderColor: theme.popBg }]}>
          <Text style={[styles.badgeText, { color: theme.popBg }]}>{chips.length}</Text>
        </View>
      ) : null}
    </View>
  );
  const lensTabs = (
    <LensTabs state={filters.state} counts={lensCounts} onSelect={(lens: Lens) => selectLens(lens)} phone={!wide} />
  );
  const newButton = <ChromeIconButton hugeIcon={PencilEdit02Icon} accessibilityLabel="New message" onPress={onNewMessage} />;
  const chrome = wide ? (
    <SidebarHeader
      testID="triage-queue-header"
      search={searchField}
      actions={
        <>
          {filterButton}
          {newButton}
        </>
      }
      below={
        <>
          {/* The tabs show the lens; this names it for screen readers and the page outline. */}
          <Text accessibilityRole="header" style={styles.visuallyHidden}>{desktopInboxTitle(filters)}</Text>
          {lensTabs}
        </>
      }
    />
  ) : (
    <SidebarChrome actions={<>{filterButton}{newButton}</>} />
  );

  const pane = (
    <SidebarFrame
      chrome={chrome}
      footer={wide ? <SidebarFooter workspace="messages" /> : null}
      thumb={<SyntheticScrollThumb state={viewport.thumb} />}
    >
      {/* Filters ride the list header, passing behind the glass top bar.
          Wide search is sticky chrome. */}
      <ConversationScrollList
          testID="conversation-list-scroll"
          // FlashListRef and FlatList's ref don't overlap; callers only use
          // scrollToOffset / scrollToIndex (ConversationListHandle).
          ref={listRef as never}
          // Until the first listConversations page lands, Today's plan would claim the queue is cleared.
          data={loading ? [] : rows}
          keyExtractor={rowKey}
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
            // The phone's floating tab bar covers the last rows otherwise.
            paddingBottom: wide ? 12 : PHONE_TAB_BAR_CLEARANCE,
            paddingHorizontal: TriageGeometry.listGutter,
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
                <View testID="phone-list-header">
                  <View style={styles.phoneLenses}>{lensTabs}</View>
                  <View style={styles.phoneSearch}>{searchField}</View>
                </View>
              )}
                            {lensOf(filters.state) === null && !search.active ? (
                <Text style={[styles.lensNote, { color: theme.textSecondary, fontSize: type.secondary }]}>Settled</Text>
              ) : null}
              {onToday && !search.active ? (
                <TodayHeaderCard header={loading ? { kind: "loading" } : todayHeader(today.view, plan)} dayStart={today.view?.dayStart ?? today.dayStart} onRequest={(mode) => void today.request(mode)} />
              ) : null}
              {!search.active && (!onToday || chips.length > 0) ? (
                <FilterChipRow
                  chips={chips}
                  views={onToday ? [] : store.views}
                  phone={!wide}
                  countLine={`${lensShowing} of ${lensTotal} match`}
                  onRemove={removeChip}
                  onClearAll={clearAll}
                  onOpenView={openView}
                  onDeleteView={(view) => deleteView(view.id)}
                />
              ) : null}
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <SkeletonList />
            ) : emptyLens ? (
              <EmptyLens
                lens={emptyLens}
                chats={allChats}
                counts={{ unresponded: counts?.unresponded ?? 0 }}
                now={Date.now()}
                onOpenChat={(chat) => {
                  onOpenChat(chat);
                  requestFocus("composer");
                }}
                onSeeAllWaiting={() => search.applyFilters({ ...filters, state: "waiting" })}
                onGoToNeedsReply={() => search.applyFilters({ ...filters, state: "unresponded" })}
              />
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
        platforms={platforms}
        counts={toggleCounts}
        showing={lensShowing}
        total={lensTotal}
        lensLabel={lensLabel}
        today={onToday}
      />
    </SidebarFrame>
  );
  return pane;
}

/**
 * One list cell. Memoized with primitive props so a click or a lens switch re-renders only the
 * cells whose row, selection or leave state changed, not all ~700 mounted ones.
 */
const InboxCell = memo(function InboxCell({ row, gone, onCollapsed, labelColor, handle, personal, selected, keyboardFocused, onOpen, agentLens, onToggleFold, onSettleAll }: {
  readonly row: InboxRow;
  readonly gone: boolean;
  readonly onCollapsed: (key: string) => void;
  readonly labelColor: string;
  readonly handle: HandleTiebreak | undefined;
  readonly personal: boolean;
  readonly selected: boolean;
  readonly keyboardFocused: boolean;
  readonly onOpen: (chat: ChatSummary) => void;
  readonly agentLens: boolean;
  readonly onToggleFold: (key: TodaySectionKey) => void;
  readonly onSettleAll: (key: TodaySectionKey) => void;
}) {
  return (
    // A leaving row ignores input, so a click mid-fold never reopens what was just settled.
    <View pointerEvents={gone ? "none" : "auto"}>
      <Collapse collapsed={gone} onCollapsed={() => onCollapsed(row.key)}>
        {row.kind === "section" ? (
          row.fold || row.detail !== undefined ? <TodaySectionHeader row={row} onToggleFold={onToggleFold} onSettleAll={onSettleAll} /> : (
            <View style={styles.group}>
              <Text accessibilityRole="header" style={[styles.groupLabel, { color: labelColor }]}>{row.label}</Text>
              <Text style={[styles.groupCount, { color: labelColor }]}>{row.count}</Text>
            </View>
          )
        ) : (
          <ChatRow chat={row.chat} handle={handle} personal={personal} selected={selected} keyboardFocused={keyboardFocused} onOpen={onOpen} agentLens={agentLens} today={row.today} leaving={gone} />
        )}
      </Collapse>
    </View>
  );
});

const SETTLE_SECTION: TodaySectionKey = `group:${TODAY_SETTLE_GROUP}`;

/** A Today section: a group title with its context line, or a fold (Below the line, Settled today). The settle group gets Settle all. */
function TodaySectionHeader({ row, onToggleFold, onSettleAll }: {
  readonly row: Extract<InboxRow, { kind: "section" }>;
  readonly onToggleFold: (key: TodaySectionKey) => void;
  readonly onSettleAll: (key: TodaySectionKey) => void;
}) {
  const theme = useTheme();
  const fold = row.fold;
  const [explained, setExplained] = useState(false);
  const info = row.detail ? <InfoTip text={row.detail} onPress={() => setExplained((open) => !open)} /> : null;
  const detail = row.detail && explained ? <Text style={[styles.todayDetail, { color: theme.textTertiary }]}>{row.detail}</Text> : null;
  if (fold) {
    return (
      <Pressable
        testID="today-fold"
        accessibilityRole="button"
        accessibilityLabel={`${row.label}, ${row.count}`}
        aria-expanded={fold.open}
        onPress={() => onToggleFold(fold.key)}
        style={({ hovered }) => [styles.fold, hovered && { backgroundColor: theme.rowHover }]}
      >
        <View style={styles.foldText}>
          <View style={styles.todayTitleRow}>
            <Text accessibilityRole="header" style={[styles.foldLabel, { color: theme.textSecondary }]}>{row.label}</Text>
            {info}
          </View>
          {detail}
        </View>
        <View style={styles.chev}>
          <Text style={[styles.groupCount, { color: theme.textTertiary }]}>{row.count}</Text>
          <Ionicons aria-hidden name={fold.open ? "chevron-down" : "chevron-forward"} size={11} color={theme.textTertiary} />
        </View>
      </Pressable>
    );
  }
  return (
    <View testID="today-group" style={styles.todayGroup}>
      <View style={styles.todayTop}>
        <View style={styles.todayTitleRow}>
          {row.tone === "fresh" ? <View style={[styles.freshDot, { backgroundColor: theme.accent }]} /> : null}
          <Text accessibilityRole="header" style={[styles.todayTitle, { color: theme.text }]}>{row.label}</Text>
          {info}
        </View>
        <View style={styles.todayActions}>
          {row.key === `section-today-${SETTLE_SECTION}` ? (
            <Pressable
              testID="today-settle-all"
              accessibilityRole="button"
              accessibilityLabel={`Settle all ${row.count} in ${row.label}`}
              onPress={() => onSettleAll(SETTLE_SECTION)}
              style={({ hovered, pressed }) => [styles.settleAll, { borderColor: theme.chipBorder, backgroundColor: hovered || pressed ? theme.rowHover : theme.chipBg }]}
            >
              <Text style={[styles.settleAllText, { color: theme.text }]}>Settle all</Text>
            </Pressable>
          ) : null}
          <Text style={[styles.groupCount, { color: theme.textTertiary }]}>{row.count}</Text>
        </View>
      </View>
      {detail}
    </View>
  );
}

const styles = StyleSheet.create({
  todayGroup: { paddingBottom: 5, paddingHorizontal: 10, paddingTop: 14 },
  todayTop: { alignItems: "baseline", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  todayTitleRow: { alignItems: "center", flexDirection: "row", flexShrink: 1, gap: 6 },
  todayTitle: { fontSize: 12, fontWeight: "600" },
  todayActions: { alignItems: "center", flexDirection: "row", gap: 8 },
  settleAll: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  settleAllText: { fontSize: 11.5, fontWeight: "600" },
  todayDetail: { fontSize: 11.5, lineHeight: 15, marginTop: 2 },
  freshDot: { borderRadius: 3.5, height: 7, width: 7 },
  fold: { alignItems: "center", borderRadius: 10, flexDirection: "row", justifyContent: "space-between", marginTop: 4, paddingHorizontal: 10, paddingVertical: 9 },
  foldText: { flex: 1, minWidth: 0 },
  foldLabel: { fontSize: 12, fontWeight: "600" },
  chev: { alignItems: "center", flexDirection: "row", gap: 4 },
  visuallyHidden: { height: 1, overflow: "hidden", position: "absolute", width: 1, opacity: 0 },
  offlineBar: { alignItems: "center", borderRadius: 8, flexDirection: "row", gap: 6, marginHorizontal: 4, marginVertical: 6, paddingHorizontal: 10, paddingVertical: 5 },
  offlineText: { flex: 1, fontSize: 12, minWidth: 0 },
  phoneLenses: { marginHorizontal: -TriageGeometry.listGutter, paddingTop: 8 },
  phoneSearch: { flexDirection: "row", paddingBottom: 6, paddingHorizontal: 8, paddingTop: 14 },
  lensNote: { fontWeight: "600", paddingHorizontal: 18, paddingTop: 10 },
  group: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 6, paddingHorizontal: 18, paddingTop: 14 },
  groupLabel: { fontSize: 11.5 },
  // Three tabular digits wide, so a count that grows while pages load (9, 42, 261) never moves.
  groupCount: { fontSize: 11.5, fontVariant: ["tabular-nums"], minWidth: "3ch", textAlign: "right" } as object,
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
