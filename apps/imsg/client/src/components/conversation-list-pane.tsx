import type { ChatSummary, StateCounts, TriageProgressStats } from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";


import { ChatRow } from "./chat-row";
import { ConversationFilters, ConversationFiltersModal, type FilterAnchor } from "./conversation-filters";
import type { PriorityShelfHandle } from "./priority-shelf";
import { SkeletonList } from "./skeleton-list";
import { TriageQueueHeader, TRIAGE_QUEUE_HEADER_HEIGHT } from "./triage-queue-header";

import { ChromeIconButton } from "./sidebar/chrome-icon-button";
import { SquarePenIcon } from "@hugeicons/core-free-icons";
import { SettingsButton } from "./sidebar/settings-button";
import { SidebarChrome } from "./sidebar/sidebar-chrome";
import { SidebarFooter } from "./sidebar/sidebar-footer";
import { SidebarFrame } from "./sidebar/sidebar-frame";
import { SidebarSearchField } from "./sidebar/sidebar-search-field";
import { SyntheticScrollThumb } from "./sidebar/synthetic-scroll-thumb";
import { useConversationListKeyboard } from "./conversations/use-conversation-list-keyboard";
import { useConversationListViewport } from "./conversations/use-conversation-list-viewport";
import { useConversationSearch } from "./conversations/use-conversation-search";

import { onTriageResolved, onTriageUndo, settleTriageChat } from "@/hooks/use-triage-actions";
import { api } from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { useType } from "@/hooks/use-type";
import { deriveInboxModel, type InboxFilters } from "@/lib/inbox-model";
import { sidebarChromeHeight, sidebarFooterHeight } from "@/lib/sidebar-metrics";
import { showToast } from "@/lib/toast";
import { isListMode, subscribeListMode } from "@/lib/keyboard/controller";
import { useSyncExternalStore } from "react";

// FlashList 2 RecyclerView commitLayout increments internal state until
// measured item sizes settle. On RN-web they don't (fractional flex + chrome
// header) — that's React #185 in commitLayout, stack pointing at FlashList
// inside ConversationListPane. Contacts already uses FlatList for this reason.
const ConversationScrollList = Platform.OS === "web" ? FlatList : FlashList;

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
  onStartSweep: (chats: ChatSummary[], startGuid?: string) => void;
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
  onStartSweep,
}: ConversationListPaneProps) {
  const theme = useTheme();
  const type = useType();
  const iosMobile = Platform.OS === "ios" && !wide;
  const search = useConversationSearch({ filters, onFiltersChange });
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState<FilterAnchor | null>(null);
  const [stats, setStats] = useState<TriageProgressStats | null>(null);
  const refreshStats = useCallback((): void => {
    if (!wide) return;
    void api.getTriageStats().then(setStats, () => undefined);
  }, [wide]);
  useEffect(() => { refreshStats(); }, [refreshStats, chats]);
  useEffect(() => {
    const refreshTriage = (): void => {
      onRefresh();
      refreshStats();
    };
    const stopResolved = onTriageResolved(refreshTriage);
    const stopUndo = onTriageUndo(refreshTriage);
    return () => {
      stopResolved();
      stopUndo();
    };
  }, [onRefresh, refreshStats]);
  const topBarH = wide ? TRIAGE_QUEUE_HEADER_HEIGHT : sidebarChromeHeight(false);
  const footerH = sidebarFooterHeight(wide);
  const filterBtnRef = useRef<View>(null);
  const selectedPositionRef = useRef<{ guid: string; index: number } | null>(null);
  const deskTitle = filters.state === "unresponded" ? "Needs reply" : filters.state === "waiting" ? "Waiting" : filters.state === "all" ? "All messages" : filters.state === "unread" ? "Unread" : "Archived";

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
    showPriorityShelf: false,
    priority: [],
    listChats: deskChats,
    navigationEntries: deskChats.map((chat, index) => ({ chat, location: { kind: "list" as const, index } })),
  }) : model, [model, deskChats, wide]);
  const sweepableChats = useMemo(() => deskModel.listChats.filter((chat) =>
    !chat.flags.archived && chat.laterUntil === null && chat.flags.unresponded,
  ), [deskModel.listChats]);
  const glide = useSyncExternalStore(subscribeListMode, isListMode, () => false);

  // All imperative list scrolling (glide pinning, view resets, reorder
  // recovery) and the synthetic thumb live in the viewport hook.
  const viewport = useConversationListViewport({
    renderedChats: deskModel.listChats,
    chromeHeight: topBarH,
    footerHeight: footerH,
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
  const renderRow = useCallback(
    ({ item }: { item: ChatSummary }) => (
      <ChatRow
        chat={item}
        selected={wide && selectedGuid === item.guid}
        keyboardFocused={wide && glide && selectedGuid === item.guid}
        onPress={() => onOpenChat(item)}
        settleAvailable={wide && (filters.state === "unresponded" || filters.state === "waiting")}
        onSettle={wide ? () => {
          const queueName = item.flags.unresponded && item.flags.waiting
            ? "Needs Reply and Waiting"
            : item.flags.unresponded ? "Needs Reply" : "Waiting";
          void settleTriageChat(item).then(() => {
            showToast(`Settled from ${queueName} — Z to undo`);
          }, () => undefined);
        } : undefined}
      />
    ),
    [wide, glide, selectedGuid, filters.state, onOpenChat],
  );

  const shelfRef = useRef<PriorityShelfHandle>(null);
  useConversationListKeyboard({
    enabled: wide,
    model: deskModel,
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

  const chrome = wide ? (
    <TriageQueueHeader
      title={deskTitle}
      completed={stats?.clearedToday ?? 0}
      sweepCount={sweepableChats.length}
      oldestAt={stats?.oldestQueueAt ?? deskModel.listChats.reduce<number | null>((oldest, chat) => {
        const at = chat.lastMessage?.dateCreated ?? null;
        return at === null ? oldest : oldest === null ? at : Math.min(oldest, at);
      }, null)}
      search={searchField}
      action={<ChromeIconButton hugeIcon={SquarePenIcon} accessibilityLabel="New message" onPress={onNewMessage} />}
      onSweep={filters.state === "unresponded" ? () => { if (sweepableChats.length) onStartSweep(sweepableChats, sweepableChats.some((chat) => chat.guid === selectedGuid) ? selectedGuid : sweepableChats[0]?.guid); } : undefined}
    />
  ) : (
    <SidebarChrome
      leading={searchField}
      actions={
        <>
          <SettingsButton />
          <ChromeIconButton ref={filterBtnRef} icon="options-outline" accessibilityLabel="Filter conversations" onPress={openFilters} />
          <ChromeIconButton hugeIcon={SquarePenIcon} accessibilityLabel="New message" onPress={onNewMessage} />
        </>
      }
    />
  );

  const pane = (
    <SidebarFrame
      chrome={chrome}
      chromeHeight={topBarH}
      footer={wide ? (
        <SidebarFooter>
          <View style={styles.footerContent}>
            <View style={styles.quietLinks}>
              <Pressable accessibilityRole="link" onPress={() => onFiltersChange({ state: "archived", type: "all" })} style={styles.quietLinkButton}><Ionicons name="archive-outline" size={14} color={theme.textSecondary} /><Text {...({ dataSet: { hoverUnderline: "true" } } as object)} style={[styles.quietLink, { color: theme.textSecondary }]}>Archived {counts?.archived ?? 0}</Text></Pressable>
              <Pressable accessibilityRole="link" onPress={() => onFiltersChange({ state: "all", type: "unknown" })} style={styles.quietLinkButton}><Ionicons name="ban-outline" size={14} color={theme.textSecondary} /><Text {...({ dataSet: { hoverUnderline: "true" } } as object)} style={[styles.quietLink, { color: theme.textSecondary }]}>Unknown</Text></Pressable>
            </View>
            <View style={styles.footerHint}><Text style={[styles.footerHintText, { color: theme.textSecondary }]}>{filters.state === "waiting" ? "Waiting settles when they reply" : filters.state === "unresponded" ? "Replying settles the queue" : "Hover for conversation actions"}</Text><Text style={[styles.footerHintText, { color: theme.textSecondary }]}>↑↓ glide · ↵ open</Text></View>
          </View>
        </SidebarFooter>
      ) : undefined}
      thumb={<SyntheticScrollThumb state={viewport.thumb} />}
    >
      {/* Filters and the labeled shelf ride the list header, passing
          behind the glass top bar. Wide search is sticky chrome. */}
      <ConversationScrollList
          testID="conversation-list-scroll"
          // FlashListRef and FlatList's ref don't overlap; callers only use
          // scrollToOffset / scrollToIndex (ConversationListHandle).
          ref={viewport.listRef as never}
          data={deskModel.listChats}
          keyExtractor={(chat) => chat.guid}
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
            paddingTop: Platform.OS === "web" ? 0 : topBarH + 8,
            paddingBottom: footerH + 12,
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
  return pane;
}

const styles = StyleSheet.create({
  footerContent: { flex: 1 },
  quietLinks: { alignItems: "center", flexDirection: "row", gap: 16, minHeight: 31, paddingHorizontal: 6 },
  quietLinkButton: { alignItems: "center", flexDirection: "row", gap: 5 },
  quietLink: { fontSize: 12, fontWeight: "500", paddingVertical: 7 },
  footerHint: { alignItems: "center", borderTopColor: "rgba(118,118,128,0.18)", borderTopWidth: 0.5, flexDirection: "row", justifyContent: "space-between", minHeight: 31, paddingHorizontal: 6 },
  footerHintText: { fontSize: 11 },
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
