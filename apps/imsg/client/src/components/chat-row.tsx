import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary } from "@shared/types";
import { memo, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Reanimated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import { useChatActions } from "@/hooks/use-chat-actions";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { prefetchThread } from "@/hooks/use-messages";
import { useTheme } from "@/hooks/use-theme";
import { useTriageTheme } from "@/hooks/use-triage-theme";
import { useType } from "@/hooks/use-type";
import { Colors, Type } from "@/constants/theme";
import { archiveChat, markChatRead, markChatUnread } from "@/lib/chat-actions";
import { pressAnchor } from "@/lib/action-sheet";
import { formatListTimestamp } from "@/lib/format";
import {
  ROW_SIGNAL_SIZE,
  RowSignalColor,
  rowSignal,
  unreadLabel,
} from "@/lib/row-signal";
import { hapticCommit } from "@/lib/haptics";
import { useWebContextMenu } from "@/lib/use-web-context-menu";

import { ChatAvatar } from "./avatar";
import { FAVORITE_GOLD } from "./person-crm-section";

const ACTION_WIDTH = 84;

function RowSignal({ chat }: { readonly chat: ChatSummary }): React.JSX.Element {
  const kind = rowSignal(chat);
  return (
    <View
      accessibilityElementsHidden={kind === null}
      accessibilityLabel={
        kind === "unread" ? `${unreadLabel(chat.unreadCount)} unread` : undefined
      }
      style={[
        styles.signal,
        kind === "unread" && { backgroundColor: RowSignalColor.unread },
      ]}
    >
      {kind === "unread" ? (
        <Text style={styles.signalCount}>{unreadLabel(chat.unreadCount)}</Text>
      ) : null}
    </View>
  );
}

/**
 * iMessage/Mail-style action pane: the colored panel tracks the finger (its
 * width follows the drag), and the icon pops as you approach the commit
 * threshold — so a decisive full swipe commits, a hesitant one springs back.
 */
function SwipeAction({
  translation,
  icon,
  label,
  color,
  side,
  commit,
}: {
  translation: SharedValue<number>;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  side: "left" | "right";
  commit: number;
}) {
  const theme = useTheme();
  const containerStyle = useAnimatedStyle(() => ({
    width: Math.max(ACTION_WIDTH, Math.abs(translation.value)),
  }));
  // Buzz once as the drag arms the action, not on release — this is the signal
  // that tells you the swipe will commit if you let go now.
  useAnimatedReaction(
    () => Math.abs(translation.value) >= commit,
    (armed, wasArmed) => {
      if (armed && wasArmed === false) runOnJS(hapticCommit)();
    },
  );
  const contentStyle = useAnimatedStyle(() => {
    const dist = Math.abs(translation.value);
    return {
      opacity: interpolate(dist, [10, 42], [0, 1], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(dist, [commit - 26, commit], [1, 1.18], Extrapolation.CLAMP) }],
    };
  });
  return (
    <Reanimated.View
      style={[
        styles.swipeAction,
        { backgroundColor: color, alignItems: side === "left" ? "flex-start" : "flex-end" },
        containerStyle,
      ]}
    >
      <Reanimated.View style={[styles.swipeActionInner, contentStyle]}>
        <Ionicons name={icon} size={23} color={theme.onAccent} />
        <Text style={styles.swipeActionLabel}>{label}</Text>
      </Reanimated.View>
    </Reanimated.View>
  );
}

function ChatRowInner({
  chat,
  selected,
  keyboardFocused = false,
  onPress,
  settleAvailable = false,
  onSettle,
}: {
  chat: ChatSummary;
  selected: boolean;
  /** Glide-mode cursor: accent edge on the selected row while navigating. */
  keyboardFocused?: boolean;
  settleAvailable?: boolean;
  onPress: () => void;
  onSettle?: () => void;
}) {
  const theme = useTheme();
  const visual = useTriageTheme();
  const type = useType();
  const { width: winW, wide: compact } = useLayoutMode();
  const { openMenu } = useChatActions(compact);
  const [hovered, setHovered] = useState(false);
  const [focusedWithin, setFocusedWithin] = useState(false);
  const [settleHovered, setSettleHovered] = useState(false);
  const [moreHovered, setMoreHovered] = useState(false);
  const actionsVisible = compact && (hovered || focusedWithin || keyboardFocused);
  const swipeRef = useRef<SwipeableMethods>(null);
  const last = chat.lastMessage;
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
    const enter = () => {
      setHovered(true);
      prefetchThread(chat.guid);
    };
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

  // Commit distance scales with row width so it's a deliberate full swipe on a
  // phone, not a hair-trigger. Capped so a tablet/desktop doesn't need a marathon.
  // Overshoot stays ON: disabling it collapses the Swipeable's interpolation to a
  // zero slope past the pane width, which clamped travel at ACTION_WIDTH while
  // commit still measured the raw finger — a dead zone the icon pop never reached.
  const commit = Math.min(190, Math.max(120, winW * 0.42));

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      containerStyle={compact ? styles.desktopRowWrap : undefined}
      friction={1}
      leftThreshold={commit}
      rightThreshold={commit}
      renderLeftActions={(_progress, translation) => (
        <SwipeAction
          translation={translation}
          icon={chat.flags.unread ? "mail-open-outline" : "mail-unread-outline"}
          label={chat.flags.unread ? "Read" : "Unread"}
          color={theme.accent}
          side="left"
          commit={commit}
        />
      )}
      renderRightActions={(_progress, translation) => (
        <SwipeAction
          translation={translation}
          icon={chat.flags.archived ? "arrow-undo-outline" : "archive-outline"}
          label={chat.flags.archived ? "Unarchive" : "Archive"}
          color="#F0A500"
          side="right"
          commit={commit}
        />
      )}
      onSwipeableOpen={(direction) => {
        // `direction` is the swipe direction, not the pane side: swiping LEFT
        // reveals the right-hand (Archive) pane, swiping RIGHT reveals the
        // left-hand (Read/Unread) pane. Fire the optimistic action then close.
        if (direction === "left") {
          archiveChat(chat, !chat.flags.archived);
        } else {
          if (chat.flags.unread) markChatRead(chat);
          else markChatUnread(chat);
        }
        swipeRef.current?.close();
      }}
    >
      <Pressable
        testID="conversation-row"
        ref={contextRef as never}
        onPress={onPress}
        onPressIn={() => prefetchThread(chat.guid)}
        onLongPress={() => openMenu(chat)}
        style={({ pressed }) => [
          styles.row,
          compact && styles.desktopRow,
          { height: compact ? 68 : undefined, minHeight: compact ? 68 : 92 },
          compact
            ? {
                backgroundColor: selected ? visual.cardSelected : hovered || focusedWithin || keyboardFocused || pressed ? visual.cardHover : "transparent",
              }
            : {
                backgroundColor: selected ? theme.backgroundSelected : pressed ? theme.backgroundElement : theme.background,
              },
        ]}
      >
        {/* Glide cursor — absolutely positioned so it never shifts layout. */}
        {keyboardFocused && (
          <View style={[styles.glideCursor, { backgroundColor: theme.accent }]} />
        )}
        <ChatAvatar chat={chat} size={compact ? 40 : 52} />
        {/* Messages-style hairline: starts after the avatar, not under it. */}
        <View
          style={[
            styles.separator,
            {
              backgroundColor: theme.divider,
              left: 16 + (compact ? 40 : 52) + 11,
              opacity: 1,
            },
          ]}
        />
        <View style={styles.content}>
          <View style={styles.topLine}>
            <View style={styles.nameGroup}>
              <Text numberOfLines={1} style={[styles.name, { color: compact ? visual.text : theme.text, fontSize: compact ? 13 : type.title, fontWeight: chat.flags.unread ? "700" : "600" }]}>
                {chat.displayName}
              </Text>
              {/* Private CRM layer (favorite/priority) — mirrors the star shown
                  on favorited rows in contacts-list-pane.tsx. */}
              {chat.crm?.is_favorite && (
                <Ionicons
                  name="star"
                  size={13}
                  color={FAVORITE_GOLD}
                  accessibilityLabel="Favorite"
                  style={styles.favoriteStar}
                />
              )}
            </View>
            {compact ? (
              <View style={styles.timeSlot}>
                {actionsVisible && settleAvailable ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Settle ${chat.displayName}`}
                    onPress={(event) => { event.stopPropagation(); onSettle?.(); }}
                    onHoverIn={() => setSettleHovered(true)}
                    onHoverOut={() => setSettleHovered(false)}
                    hitSlop={5}
                    style={({ pressed }) => [
                      styles.inlineSettle,
                      settleHovered && !pressed && { backgroundColor: visual.controlFill },
                      pressed && { backgroundColor: visual.controlFillHover },
                    ]}
                  >
                    <Ionicons name="checkmark" size={13} color={settleHovered ? visual.text : visual.muted} />
                    <Text style={[styles.inlineSettleText, { color: settleHovered ? visual.text : visual.muted }]}>Settle</Text>
                  </Pressable>
                ) : last ? (
                  <Text style={[styles.time, { color: visual.muted, fontSize: 11 }]}>
                    {formatListTimestamp(last.dateCreated)}
                  </Text>
                ) : null}
              </View>
            ) : last ? (
              <Text style={[styles.time, { color: theme.textSecondary, fontSize: type.secondary }]}>
                {formatListTimestamp(last.dateCreated)}
              </Text>
            ) : null}
          </View>
          <View style={styles.messageRow}>
            <Text numberOfLines={compact ? 2 : 1} style={[styles.messagePreview, { color: compact ? visual.snippet : theme.textSecondary, fontSize: compact ? 12 : 14, lineHeight: compact ? 15 : 18, fontWeight: chat.flags.unread ? "500" : "400" }]}>{snippet}</Text>
            {compact && actionsVisible ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`More actions for ${chat.displayName}`}
                onPress={(event) => {
                  event.stopPropagation();
                  openMenu(chat, { ...pressAnchor(event), align: "end" });
                }}
                onHoverIn={() => setMoreHovered(true)}
                onHoverOut={() => setMoreHovered(false)}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.inlineMore,
                  moreHovered && !pressed && { backgroundColor: visual.controlFill },
                  pressed && { backgroundColor: visual.controlFillHover },
                ]}
              >
                <Ionicons name="ellipsis-horizontal" size={16} color={moreHovered ? visual.text : visual.muted} />
              </Pressable>
            ) : (
              <View style={styles.messageSignal}>
                <RowSignal chat={chat} />
              </View>
            )}
          </View>
        </View>
        {!compact && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={chat.flags.archived ? "Unarchive conversation" : "Archive conversation"}
            onPress={(e) => {
              e.stopPropagation();
              archiveChat(chat, !chat.flags.archived);
            }}
            hitSlop={6}
            pointerEvents={hovered ? "auto" : "none"}
            style={[
              styles.hoverArchive,
              { backgroundColor: theme.backgroundSelected, opacity: hovered ? 1 : 0 },
            ]}
          >
            <Ionicons
              name={chat.flags.archived ? "arrow-undo-outline" : "archive-outline"}
              size={15}
              color={theme.text}
            />
          </Pressable>
        )}
      </Pressable>
    </ReanimatedSwipeable>
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
  desktopRowWrap: {
    overflow: "visible",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 80,
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 14,
  },
  desktopRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  separator: {
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    position: "absolute",
    right: 0,
  },
  glideCursor: {
    borderRadius: 2,
    bottom: 8,
    left: 0,
    position: "absolute",
    top: 8,
    width: 3,
  },
  content: {
    flex: 1,
    marginLeft: 11,
    minWidth: 0,
    paddingVertical: 2,
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
    fontSize: 17,
    letterSpacing: -0.2,
    minWidth: 0,
  },
  time: {
    flexShrink: 0,
    fontSize: 13,
  },
  favoriteStar: {
    flexShrink: 0,
  },
  messageRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 7,
    marginTop: 1,
    minHeight: 30,
  },
  messageSignal: {
    alignSelf: "center",
  },
  messagePreview: {
    flex: 1,
    minWidth: 0,
  },
  timeSlot: {
    alignItems: "flex-end",
    flexShrink: 0,
    justifyContent: "center",
    width: 62,
  },
  inlineSettle: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    gap: 3,
    justifyContent: "center",
    // Chip bleeds past the 13px text box via negative margins so the hover
    // fill has breathing room without shifting row spacing.
    marginHorizontal: -5,
    marginVertical: -3,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  inlineSettleText: {
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 13,
  },
  inlineMore: {
    alignSelf: "center",
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
  signalCount: {
    color: RowSignalColor.onFill,
    fontSize: 10,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
  },
  hoverArchive: {
    alignItems: "center",
    borderRadius: 14,
    height: 28,
    justifyContent: "center",
    marginTop: -14,
    position: "absolute",
    right: 10,
    top: "50%",
    width: 28,
    zIndex: 2,
  },
  swipeAction: {
    width: ACTION_WIDTH,
    justifyContent: "center",
  },
  swipeActionInner: {
    alignItems: "center",
    gap: 3,
    width: ACTION_WIDTH,
  },
  swipeActionLabel: {
    color: Colors.light.onAccent,
    fontSize: Type.secondary,
    fontWeight: "600",
  },
});
