import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary, StateCounts } from "@shared/types";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { SafeAreaView } from "react-native-safe-area-context";


import { ChatRow } from "./chat-row";
import { ConversationFilters, ConversationFiltersModal, type FilterAnchor } from "./conversation-filters";
import { NavSwitcher } from "./nav-switcher";
import { PriorityShelf } from "./priority-shelf";
import { SkeletonList } from "./skeleton-list";

import { SidebarSearchField } from "./sidebar/sidebar-search-field";
import { SIDEBAR_CHROME_HEIGHT } from "./sidebar/use-synthetic-scroll-metrics";
import { useConversationListViewport } from "./conversations/use-conversation-list-viewport";
import { useConversationSearch } from "./conversations/use-conversation-search";

import { useChatActions } from "@/hooks/use-chat-actions";
import { useTheme } from "@/hooks/use-theme";
import { useAiStatus } from "@/hooks/use-ai";
import { useActionSheet } from "@/lib/action-sheet";
import { setSuggestionMode, useSuggestionMode, type SuggestionMode } from "@/lib/settings";
import {
  deriveInboxModel,
  neighborAfterRemoval,
  nextNavigationTarget,
  type InboxFilters,
} from "@/lib/inbox-model";
import {
  isListMode,
  registerFocusTarget,
  registerListAdapter,
  requestFocus,
  subscribeListMode,
} from "@/lib/keyboard/controller";
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
  /** Glide-mode j/k selection: show the thread without focusing or marking read. */
  onPreviewChat?: (chat: ChatSummary) => void;
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
  const showSheet = useActionSheet();
  const aiStatus = useAiStatus();
  const suggestionMode = useSuggestionMode();
  const iosMobile = Platform.OS === "ios" && !wide;
  const search = useConversationSearch({ filters, onFiltersChange });
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState<FilterAnchor | null>(null);
  const topBarH = SIDEBAR_CHROME_HEIGHT;
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
  const aiBtnRef = useRef<View>(null);
  const openSuggestionSettings = (): void => {
    const options: Array<{ label: string; mode: SuggestionMode }> = [
      { label: "Off", mode: "off" },
      { label: "On demand", mode: "on-demand" },
      { label: "Automatic", mode: "auto" },
    ];
    const show = (anchor?: { x: number; y: number }) =>
      showSheet({
        title: "Reply suggestions",
        actions: options.map((o) => ({
          // A leading check marks the active mode; the sheet has no selected state.
          label: `${suggestionMode === o.mode ? "✓  " : "    "}${o.label}`,
          onPress: () => setSuggestionMode(o.mode),
        })),
        anchor,
      });
    // Desktop: popover mounted under the button; mobile keeps the sheet.
    if (wide && aiBtnRef.current) {
      aiBtnRef.current.measureInWindow((x, y, _w, h) => show({ x, y: y + h + 4 }));
    } else {
      show();
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
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Keyboard adapter: glide-mode navigation follows the RENDERED order
  // (priority shelf first, then the filtered list) — not the raw chats array.
  const navRef = useRef({ model, selectedGuid, onOpenChat, onPreviewChat });
  navRef.current = { model, selectedGuid, onOpenChat, onPreviewChat };
  const searchCtl = useRef(search);
  searchCtl.current = search;

  useEffect(
    () => registerFocusTarget("list-search", () => searchCtl.current.inputRef.current?.focus()),
    [],
  );

  useEffect(() => {
    if (!wide) return;
    return registerListAdapter({
      move(delta) {
        const { model: m, selectedGuid: sel, onOpenChat: open, onPreviewChat: preview } = navRef.current;
        const target = nextNavigationTarget(m.navigationEntries, sel, delta);
        if (!target || target.chat.guid === sel) return;
        (preview ?? open)(target.chat);
        viewportRef.current.revealEntry(target, delta);
      },
      activate() {
        const { model: m, selectedGuid: sel, onOpenChat: open } = navRef.current;
        const target =
          m.navigationEntries.find((e) => e.chat.guid === sel) ?? m.navigationEntries[0];
        if (target) open(target.chat);
      },
      focusSearch() {
        // The field is the list header on desktop — reveal it, then focus via
        // the registry (pending-focus handles a not-yet-mounted field; no
        // timer-based sequencing).
        viewportRef.current.scrollToTop();
        requestFocus("list-search");
      },
      clearSearch() {
        return searchCtl.current.clear();
      },
      selectNeighborOf(guid) {
        // Runs synchronously after the removal action, before re-render — so
        // the current model still contains `guid` and its neighbors.
        const { model: m, onOpenChat: open, onPreviewChat: preview } = navRef.current;
        const neighbor = neighborAfterRemoval(m.navigationEntries, guid);
        if (neighbor) (preview ?? open)(neighbor.chat);
      },
    });
  }, [wide]);

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
                filters={filters}
                counts={counts}
                // Picking a badge exits search — the two never compose.
                onFiltersChange={(f) => search.applyFilters(f)}
              />
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
        {viewport.thumb.visible && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.scrollThumb,
              {
                top: viewport.thumb.top,
                height: viewport.thumb.height,
                transform: [{ translateY: viewport.thumb.translateY }],
              },
            ]}
          />
        )}
        {/* Frosted top bar — floats over the scroll, the only fixed chrome. */}
        <View style={[styles.topBar, glassStyle]}>
          {wide ? <NavSwitcher active="messages" style={styles.navInline} /> : searchField}
          <View style={styles.titleActions}>
            {aiStatus?.suggestions && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Suggestion settings"
                ref={aiBtnRef}
                onPress={openSuggestionSettings}
                style={({ pressed }) => [styles.titleButton, pressed && { opacity: 0.55 }]}
              >
                <Ionicons name="sparkles-outline" size={20} color={theme.accent} />
              </Pressable>
            )}
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
    height: 58,
    justifyContent: "space-between",
    left: 0,
    paddingHorizontal: 16,
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
