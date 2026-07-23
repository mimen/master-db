import type { FlashListRef } from "@shopify/flash-list";
import { useEffect, useRef } from "react";
import { Platform, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import type { ViewToken } from "react-native";

import type { ChatSummary } from "@shared/types";

import {
  useSyntheticScrollMetrics,
  type SyntheticThumbState,
} from "../sidebar/use-synthetic-scroll-metrics";

import type { InboxNavigationEntry } from "@/lib/inbox-model";

export interface ConversationListViewport {
  readonly listRef: React.RefObject<FlashListRef<ChatSummary> | null>;
  readonly thumb: SyntheticThumbState;
  /** Wire these straight onto the FlashList. */
  readonly viewabilityConfig: { itemVisiblePercentThreshold: number };
  onViewableItemsChanged(info: { viewableItems: ViewToken[] }): void;
  onLayout(height: number): void;
  onScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void;

  scrollToTop(): void;
  /** Scroll so a navigation target is fully visible, edge-pinned toward the
   * direction of travel. Priority targets reveal the header (shelf). */
  revealEntry(entry: InboxNavigationEntry, delta: -1 | 1): void;
}

/**
 * THE owner of the conversation FlashList's imperative scrolling — no other
 * module may call its scroll methods. Bundles: nullable fully-visible range,
 * glide edge-pinning, new-view scroll-to-top, web reorder restoration, and
 * the shared synthetic-thumb metrics.
 */
export function useConversationListViewport(args: {
  /** The list actually rendered (model.listChats) — reorder recovery and the
   * visible range are only meaningful against it. */
  readonly renderedChats: readonly ChatSummary[];
  readonly chromeHeight: number;
  /** Changes exactly when the view changes (lens/query) — resets to top. */
  readonly viewKey: string;
}): ConversationListViewport {
  const { renderedChats, chromeHeight, viewKey } = args;
  const listRef = useRef<FlashListRef<ChatSummary>>(null);
  const scrollOffset = useRef(0);
  // Nullable: null = "no measurement for the current view yet". Reset when
  // the rendered view changes so a stale range never suppresses a reveal.
  const viewableRange = useRef<{ first: number; last: number } | null>(null);

  const metrics = useSyntheticScrollMetrics({
    chromeHeight,
    estimatedContentHeight: renderedChats.length * 76 + chromeHeight + 240,
  });

  // Changing a lens or the query is a NEW view — start it from the top.
  // (Without this, maintainVisibleContentPosition anchors whatever row was
  // visible, so releasing a filter "follows" that conversation down the list.)
  useEffect(() => {
    scrollOffset.current = 0;
    viewableRange.current = null;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [viewKey]);

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
  }, [renderedChats]);

  return {
    listRef,
    thumb: metrics.thumb,
    viewabilityConfig: { itemVisiblePercentThreshold: 100 },
    onViewableItemsChanged({ viewableItems }) {
      const indices = viewableItems
        .map((v) => v.index)
        .filter((i): i is number => typeof i === "number");
      if (indices.length > 0) {
        viewableRange.current = { first: Math.min(...indices), last: Math.max(...indices) };
      }
    },
    onLayout(height) {
      metrics.onViewportHeight(height);
    },
    onScroll(event) {
      scrollOffset.current = event.nativeEvent.contentOffset.y;
      metrics.onScroll(event);
    },
    scrollToTop() {
      scrollOffset.current = 0;
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    },
    revealEntry(entry, delta) {
      if (entry.location.kind === "priority") {
        // Shelf rows live in the list header — scroll to top to reveal them.
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        return;
      }
      // Keep the glide cursor FULLY on screen with edge-pinning: scroll the
      // minimum so the row sits flush at the edge being moved toward, where
      // it stays step after step (no recentering jumps). The viewable range
      // counts only fully-visible rows, so a partially clipped cursor pins.
      const listIndex = entry.location.index;
      const range = viewableRange.current;
      if (range === null || listIndex < range.first || listIndex > range.last) {
        try {
          // Top pin must clear the frosted bar, which overlays content.
          // FlashList ignores viewOffset, so express the clearance as a
          // fraction of the measured viewport instead.
          const topFraction = Math.min(
            0.3,
            (chromeHeight + 8) / Math.max(1, metrics.viewportHeight()),
          );
          listRef.current?.scrollToIndex(
            delta > 0
              ? { index: listIndex, viewPosition: 1, animated: false }
              : { index: listIndex, viewPosition: topFraction, animated: false },
          );
        } catch {
          /* index not measured yet — FlashList will settle on next frame */
        }
      }
    },
  };
}
