import { useCallback, useEffect, useMemo, useRef } from "react";
import { Platform, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from "react-native";

import { resolveThreadFeedLiveFollow, type ThreadFeedLiveFollowEvent } from "./vendor/thread-feed-live-follow";

const END_SLOP = 8;
/** A wheel gesture has no end event; this much quiet counts as the hand leaving the wheel. */
const WHEEL_IDLE_MS = 160;

/**
 * Wires a ScrollView to T3's live-follow rule: stick to the newest output until the user scrolls
 * up, resume once they come back to the end. Native drags report their own session; on web a
 * wheel burst stands in for one.
 */
export function useLiveFollow() {
  const ref = useRef<ScrollView>(null);
  const following = useRef(true);
  const session = useRef(false);
  const metrics = useRef({ offset: 0, content: 0, viewport: 0 });

  const atEnd = () => metrics.current.content - metrics.current.viewport - metrics.current.offset <= END_SLOP;
  const apply = (event: ThreadFeedLiveFollowEvent) => {
    following.current = resolveThreadFeedLiveFollow(following.current, event);
  };
  const track = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    metrics.current = { offset: contentOffset.y, content: contentSize.height, viewport: layoutMeasurement.height };
  };
  const endSession = () => {
    apply({ type: "user-scroll-end", isAtEnd: atEnd(), userScrollSessionActive: session.current });
    session.current = false;
  };

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = (ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null)?.getScrollableNode?.();
    if (!node) return;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const onWheel = () => {
      if (!session.current) {
        session.current = true;
        apply({ type: "user-scroll-begin" });
      }
      clearTimeout(idle);
      idle = setTimeout(endSession, WHEEL_IDLE_MS);
    };
    node.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      clearTimeout(idle);
      node.removeEventListener("wheel", onWheel);
    };
  }, []);

  const follow = useCallback(() => {
    apply({ type: "reset" });
    ref.current?.scrollToEnd({ animated: false });
  }, []);
  const disclosure = useCallback(() => {
    apply({ type: "disclosure-settled", isAtEnd: atEnd(), userScrollSessionActive: session.current });
  }, []);

  const scrollProps = useMemo(() => ({
    ref,
    scrollEventThrottle: 32,
    onLayout: (event: LayoutChangeEvent) => {
      metrics.current.viewport = event.nativeEvent.layout.height;
      if (following.current) ref.current?.scrollToEnd({ animated: false });
    },
    onContentSizeChange: (_width: number, height: number) => {
      metrics.current.content = height;
      if (following.current) ref.current?.scrollToEnd({ animated: false });
    },
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      track(event);
      apply({ type: "scroll", isAtEnd: atEnd(), userScrollSessionActive: session.current });
    },
    onScrollBeginDrag: () => {
      session.current = true;
      apply({ type: "user-scroll-begin" });
    },
    onScrollEndDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      track(event);
      endSession();
    },
  }), []);

  return { scrollProps, follow, disclosure };
}
