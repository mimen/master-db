import { Ionicons } from "@expo/vector-icons";
import { settleActionFor } from "@shared/chat-state";
import type { ChatSummary } from "@shared/types";
import { memo, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  ReduceMotion,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";

import { Springs } from "@/constants/springs";
import { useChatActions } from "@/hooks/use-chat-actions";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useRowSettle } from "@/hooks/use-triage-actions";
import { markOpenStart } from "@/lib/open-timing";
import { useTheme } from "@/hooks/use-theme";
import { TriageGeometry } from "@/constants/triage-theme";
import { markChatRead, markChatUnread } from "@/lib/chat-actions";
import { pressAnchor } from "@/lib/action-sheet";
import { formatListTimestamp } from "@/lib/format";
import { RowAge } from "./conversations/row-age";
import { ROW_SIGNAL_SIZE, UNREAD_DOT_SIZE, rowSignal } from "@/lib/row-signal";
import { rubberBand, SWIPE_THRESHOLD } from "@/lib/row-swipe";
import { hapticCommit } from "@/lib/haptics";
import { useWebContextMenu } from "@/lib/use-web-context-menu";

import { ChatAvatar } from "./avatar";
import { FAVORITE_GOLD } from "./person-crm-section";

function RowSignal({ chat }: { readonly chat: ChatSummary }): React.JSX.Element {
  const theme = useTheme();
  const unread = rowSignal(chat) === "unread";
  return (
    <View aria-hidden style={styles.signal}>
      {unread ? <View testID="unread-dot" style={[styles.unreadDot, { backgroundColor: theme.accent }]} /> : null}
    </View>
  );
}

/**
 * The block under a phone row while it is dragged. It sits flush and square:
 * a quiet gray icon until the threshold, then the action's fill and label.
 */
function SwipeAction({
  offset,
  side,
  icon,
  label,
  armedFill,
}: {
  offset: SharedValue<number>;
  side: "left" | "right";
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  armedFill: string;
}): React.JSX.Element {
  const theme = useTheme();
  const [armed, setArmed] = useState(false);
  useAnimatedReaction(
    () => (side === "right" ? -offset.value : offset.value) >= SWIPE_THRESHOLD,
    (now, before) => {
      if (now !== before) runOnJS(setArmed)(now);
    },
  );
  const block = useAnimatedStyle(() => {
    const width = Math.max(0, side === "right" ? -offset.value : offset.value);
    return { width };
  });
  const color = armed ? theme.onSwipe : theme.onSwipeIdle;
  return (
    <Reanimated.View
      aria-hidden
      style={[
        styles.swipeBlock,
        side === "right" ? styles.swipeRight : styles.swipeLeft,
        { backgroundColor: armed ? armedFill : theme.swipeIdle },
        block,
      ]}
    >
      <View style={styles.swipeContent}>
        <Ionicons name={icon} size={22} color={color} />
        {armed ? <Text numberOfLines={1} style={[styles.swipeLabel, { color }]}>{label}</Text> : null}
      </View>
    </Reanimated.View>
  );
}

function ChatRowInner({
  chat,
  handle,
  selected,
  keyboardFocused = false,
  onPress,
}: {
  chat: ChatSummary;
  /** The handle that separates this row from another with the same name. */
  handle?: string;
  selected: boolean;
  /** Glide-mode cursor: the persimmon ring on the selected row while navigating. */
  keyboardFocused?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { wide: compact } = useLayoutMode();
  const { openMenu } = useChatActions(compact);
  const settle = useRowSettle(chat);
  const [hovered, setHovered] = useState(false);
  const [focusedWithin, setFocusedWithin] = useState(false);
  const [settleHovered, setSettleHovered] = useState(false);
  const [moreHovered, setMoreHovered] = useState(false);
  const actionsVisible = compact && (hovered || focusedWithin || keyboardFocused);
  const last = chat.lastMessage;
  // One rule for the chip and the swipe alike: the row offers Settle exactly
  // when the toggle has something to do, whatever lens the list is showing.
  const settleAction = settleActionFor(chat);
  const settleOffered = settleAction !== "none";
  const settleLabel = settleAction === "unsettle" ? "Un-settle" : "Settle";
  const snippet = last
    ? `${last.isFromMe ? "You: " : chat.isGroup && last.senderName ? `${last.senderName.split(" ")[0]}: ` : ""}${
        last.text || (last.hasAttachments ? "Attachment" : "")
      }`
    : "";

  const contextRef = useWebContextMenu<typeof Pressable>((anchor) => openMenu(chat, anchor));

  // DOM hover and focus-within keep the trailing actions present while the
  // pointer or keyboard moves from the row into one of its child buttons.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = contextRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    const enter = () => setHovered(true);
    const leave = () => setHovered(false);
    const focusIn = () => setFocusedWithin(true);
    const focusOut = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node) || !node.contains(event.relatedTarget)) {
        setFocusedWithin(false);
      }
    };
    node.addEventListener("mouseenter", enter);
    node.addEventListener("mouseleave", leave);
    node.addEventListener("focusin", focusIn);
    node.addEventListener("focusout", focusOut);
    return () => {
      node.removeEventListener("mouseenter", enter);
      node.removeEventListener("mouseleave", leave);
      node.removeEventListener("focusin", focusIn);
      node.removeEventListener("focusout", focusOut);
    };
  }, [chat.guid, contextRef]);

  // Phone swipe: left settles, right toggles unread. The row follows the
  // finger 1:1, rubber-bands past the threshold, buzzes once as it arms, and
  // commits on release; dragging back under the threshold disarms.
  const offset = useSharedValue(0);
  const dragging = useSharedValue(false);
  const toggleRead = (): void => {
    if (chat.flags.unread) markChatRead(chat);
    else markChatUnread(chat);
  };
  useAnimatedReaction(
    () => Math.abs(offset.value) >= SWIPE_THRESHOLD && dragging.value,
    (armed, wasArmed) => {
      if (armed && wasArmed === false) runOnJS(hapticCommit)();
    },
  );
  const pan = Gesture.Pan()
    .enabled(!compact)
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onBegin(() => {
      dragging.value = true;
    })
    .onUpdate((event) => {
      const dx = !settleOffered && event.translationX < 0 ? 0 : event.translationX;
      offset.value = rubberBand(dx);
    })
    .onFinalize(() => {
      dragging.value = false;
      const committed = Math.abs(offset.value) >= SWIPE_THRESHOLD;
      if (committed && offset.value < 0 && settleOffered) runOnJS(settle)();
      else if (committed && offset.value > 0) runOnJS(toggleRead)();
      // An armed release slides home on smooth; an unarmed one springs back on snappy.
      offset.value = withSpring(0, { ...(committed ? Springs.smooth : Springs.snappy), reduceMotion: ReduceMotion.System });
    });
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  const fill = selected ? theme.rowSelected : hovered || focusedWithin ? theme.rowHover : "transparent";

  const row = (
    <Pressable
      testID="conversation-row"
      ref={contextRef as never}
      role="button"
      // The dot is drawn, so unread has to be spoken here too.
      aria-label={[chat.displayName, chat.flags.unread || chat.unreadCount > 0 ? "unread" : null, snippet, last ? formatListTimestamp(last.dateCreated) : null].filter(Boolean).join(", ")}
      aria-selected={selected}
      onPress={onPress}
      onPressIn={() => markOpenStart(chat.guid)}
      onLongPress={() => openMenu(chat)}
      style={({ pressed }) => [
        styles.row,
        compact ? styles.rowWide : styles.rowPhone,
        { backgroundColor: pressed && !selected ? theme.rowSelected : fill },
        // Drawn inside the pill so the neighbor never clips it, and no content shifts.
        keyboardFocused && ({ outlineColor: theme.focusRing, outlineStyle: "solid", outlineWidth: 2, outlineOffset: -2 } as object),
      ]}
    >
      <ChatAvatar chat={chat} size={compact ? 32 : 44} />
      <View style={styles.content}>
        <View style={styles.topLine}>
          <View style={styles.nameGroup}>
            <Text numberOfLines={1} style={[styles.name, { color: theme.text, fontSize: compact ? 13 : 17 }]}>
              {chat.displayName}
            </Text>
            {handle && (
              <Text numberOfLines={1} style={[styles.handle, { color: theme.textSecondary }]}>
                {handle}
              </Text>
            )}
            {/* Private CRM layer (favorite/priority). Mirrors the star on favorited contacts. */}
            {chat.crm?.is_favorite && (
              <Ionicons name="star" size={12} color={FAVORITE_GOLD} accessibilityLabel="Favorite" style={styles.favoriteStar} />
            )}
          </View>
          {/* Trailing slot: the time, or the hover actions on desktop. */}
          <View style={compact ? styles.timeSlot : null}>
            {compact && actionsVisible && settleOffered ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${settleLabel} ${chat.displayName}`}
                // One tab stop per row: ⌘E settles the focused row, so these stay pointer-only.
                tabIndex={-1}
                onPress={(event) => { event.stopPropagation(); settle(); }}
                onHoverIn={() => setSettleHovered(true)}
                onHoverOut={() => setSettleHovered(false)}
                hitSlop={5}
                style={({ pressed }) => [
                  styles.inlineSettle,
                  settleHovered && !pressed && { backgroundColor: theme.rowHover },
                  pressed && { backgroundColor: theme.rowSelected },
                ]}
              >
                <Ionicons name={settleAction === "unsettle" ? "arrow-undo-outline" : "checkmark"} size={13} color={settleHovered ? theme.text : theme.textSecondary} />
                <Text numberOfLines={1} style={[styles.inlineSettleText, { color: settleHovered ? theme.text : theme.textSecondary }]}>{settleLabel}</Text>
              </Pressable>
            ) : last ? (
              <Text style={[styles.time, { color: theme.textTertiary, fontSize: compact ? 12 : 15 }]}>
                <RowAge chat={chat} />
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.messageRow}>
          <Text
            numberOfLines={2}
            style={[styles.messagePreview, { color: theme.textSecondary, fontSize: compact ? 12.5 : 15, lineHeight: compact ? 17 : 20 }]}
          >
            {snippet}
          </Text>
          {compact && actionsVisible ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`More actions for ${chat.displayName}`}
              tabIndex={-1}
              onPress={(event) => {
                event.stopPropagation();
                openMenu(chat, { ...pressAnchor(event), align: "end" });
              }}
              onHoverIn={() => setMoreHovered(true)}
              onHoverOut={() => setMoreHovered(false)}
              hitSlop={6}
              style={({ pressed }) => [
                styles.inlineMore,
                moreHovered && !pressed && { backgroundColor: theme.rowHover },
                pressed && { backgroundColor: theme.rowSelected },
              ]}
            >
              <Ionicons name="ellipsis-horizontal" size={16} color={moreHovered ? theme.text : theme.textSecondary} />
            </Pressable>
          ) : (
            <View style={styles.messageSignal}>
              <RowSignal chat={chat} />
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );

  if (compact) return <View style={styles.gap}>{row}</View>;

  return (
    <View style={[styles.gap, styles.swipeHost]}>
      <SwipeAction
        offset={offset}
        side="left"
        icon={chat.flags.unread ? "mail-open-outline" : "radio-button-on-outline"}
        label={chat.flags.unread ? "Mark read" : "Mark unread"}
        armedFill={theme.swipeUnread}
      />
      {settleOffered ? (
        <SwipeAction
          offset={offset}
          side="right"
          icon={settleAction === "unsettle" ? "arrow-undo-outline" : "checkmark"}
          label={settleLabel}
          armedFill={theme.swipeSettle}
        />
      ) : null}
      <GestureDetector gesture={pan}>
        <Reanimated.View style={[styles.slide, { backgroundColor: theme.background }, slide]}>{row}</Reanimated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * Plain shallow memo. This only pays off because chat-store reconciles object
 * identity on refetch — without that every row would see a "new" chat each
 * poll. Deliberately not a hand-listed field comparator: that silently rots
 * the moment ChatSummary grows a field.
 */
export const ChatRow = memo(ChatRowInner);

const styles = StyleSheet.create({
  gap: { marginBottom: TriageGeometry.rowGap },
  // Square and full-bleed while dragging: the swipe host cancels the list's
  // 8px gutter so the action block reaches the screen edge.
  swipeHost: { marginHorizontal: -TriageGeometry.listGutter, overflow: "hidden" },
  slide: { paddingHorizontal: TriageGeometry.listGutter },
  row: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  rowWide: {
    borderRadius: TriageGeometry.rowRadius,
    gap: 10,
    paddingBottom: 10,
    paddingHorizontal: 10,
    paddingTop: 9,
  },
  rowPhone: {
    alignItems: "center",
    borderRadius: TriageGeometry.rowRadiusMobile,
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  topLine: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 8,
  },
  nameGroup: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 5,
    minWidth: 0,
  },
  name: {
    flexShrink: 1,
    fontWeight: "600",
    minWidth: 0,
  },
  time: {
    flexShrink: 0,
    fontVariant: ["tabular-nums"],
  },
  favoriteStar: {
    flexShrink: 0,
  },
  // Shrinks before the name does: the name is what the row is, the handle only separates it.
  handle: {
    flexShrink: 2,
    fontSize: 12,
    minWidth: 0,
  },
  messageRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 7,
    marginTop: 1,
  },
  messageSignal: {
    alignSelf: "flex-start",
  },
  messagePreview: {
    flex: 1,
    minWidth: 0,
  },
  timeSlot: {
    alignItems: "flex-end",
    flexShrink: 0,
    justifyContent: "center",
    minWidth: 22,
  },
  inlineSettle: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    gap: 3,
    justifyContent: "center",
    // Bleeds past the 13px text box so the hover fill has room without shifting the row.
    marginHorizontal: -5,
    marginVertical: -3,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  inlineSettleText: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 14,
  },
  inlineMore: {
    alignItems: "center",
    borderRadius: ROW_SIGNAL_SIZE / 2,
    flexShrink: 0,
    height: ROW_SIGNAL_SIZE,
    justifyContent: "center",
    width: ROW_SIGNAL_SIZE,
  },
  signal: {
    alignItems: "center",
    borderRadius: ROW_SIGNAL_SIZE / 2,
    flexShrink: 0,
    height: ROW_SIGNAL_SIZE,
    justifyContent: "center",
    width: ROW_SIGNAL_SIZE,
  },
  unreadDot: {
    borderRadius: UNREAD_DOT_SIZE / 2,
    height: UNREAD_DOT_SIZE,
    width: UNREAD_DOT_SIZE,
  },
  swipeBlock: {
    bottom: 0,
    justifyContent: "center",
    overflow: "hidden",
    position: "absolute",
    top: 0,
  },
  swipeLeft: { alignItems: "flex-start", left: 0 },
  swipeRight: { alignItems: "flex-end", right: 0 },
  swipeContent: { alignItems: "center", flexDirection: "row", gap: 10, paddingHorizontal: 30 },
  swipeLabel: { fontSize: 16, fontWeight: "600" },
});
