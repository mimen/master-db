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
import { useType } from "@/hooks/use-type";
import { Colors, Type } from "@/constants/theme";
import { archiveChat, markChatRead, markChatUnread } from "@/lib/chat-actions";
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
        kind === "unread"
          ? `${unreadLabel(chat.unreadCount)} unread`
          : kind === "unresponded"
            ? "Unresponded"
            : kind === "archived"
              ? "Archived"
              : undefined
      }
      style={[
        styles.signal,
        kind === "unread" && { backgroundColor: RowSignalColor.unread },
        kind === "unresponded" && { backgroundColor: RowSignalColor.unresponded },
        kind === "archived" && { backgroundColor: RowSignalColor.archived },
      ]}
    >
      {kind === "unread" ? (
        <Text style={styles.signalCount}>{unreadLabel(chat.unreadCount)}</Text>
      ) : kind === "unresponded" ? (
        <Ionicons name="arrow-undo-outline" size={11} color={RowSignalColor.unrespondedGlyph} />
      ) : kind === "archived" ? (
        <Ionicons name="archive-outline" size={11} color={RowSignalColor.onFill} />
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
}: {
  chat: ChatSummary;
  selected: boolean;
  /** Glide-mode cursor: accent edge on the selected row while navigating. */
  keyboardFocused?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const type = useType();
  const { openMenu } = useChatActions();
  const { width: winW, wide: compact } = useLayoutMode();
  const [hovered, setHovered] = useState(false);
  const swipeRef = useRef<SwipeableMethods>(null);
  const last = chat.lastMessage;
  const snippet = last
    ? `${last.isFromMe ? "You: " : chat.isGroup && last.senderName ? `${last.senderName.split(" ")[0]}: ` : ""}${
        last.text || (last.hasAttachments ? "Attachment" : "")
      }`
    : "";

  const contextRef = useWebContextMenu<typeof Pressable>((anchor) => openMenu(chat, anchor));

  // Hover via DOM mouseenter/mouseleave: unlike RNW's hover events these do
  // not fire when the pointer moves onto a child (the archive button).
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = contextRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    const enter = () => {
      setHovered(true);
      prefetchThread(chat.guid);
    };
    const leave = () => setHovered(false);
    node.addEventListener("mouseenter", enter);
    node.addEventListener("mouseleave", leave);
    return () => {
      node.removeEventListener("mouseenter", enter);
      node.removeEventListener("mouseleave", leave);
    };
  }, [chat.guid]);

  // Commit distance scales with row width so it's a deliberate full swipe on a
  // phone, not a hair-trigger. Capped so a tablet/desktop doesn't need a marathon.
  // Overshoot stays ON: disabling it collapses the Swipeable's interpolation to a
  // zero slope past the pane width, which clamped travel at ACTION_WIDTH while
  // commit still measured the raw finger — a dead zone the icon pop never reached.
  const commit = Math.min(190, Math.max(120, winW * 0.42));

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
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
        ref={contextRef as never}
        onPress={onPress}
        onPressIn={() => prefetchThread(chat.guid)}
        onLongPress={() => openMenu(chat)}
        style={({ pressed }) => [
          styles.row,
          { minHeight: compact ? 80 : 92 },
          {
            backgroundColor: selected
              ? theme.backgroundSelected
              : pressed || (compact && hovered)
                ? theme.backgroundElement
                : theme.background,
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
            },
          ]}
        />
        <View style={styles.content}>
          <View style={styles.topLine}>
            <Text numberOfLines={1} style={[styles.name, { color: theme.text, fontSize: type.title, fontWeight: chat.flags.unread ? "700" : "600" }]}>
              {chat.displayName}
            </Text>
            {/* Private CRM layer (favorite/priority) — mirrors the star shown
                on favorited rows in contacts-list-pane.tsx. Priority is kept
                subtle: only P1/P2 (the top two of five levels) get a dot, so
                the row doesn't turn into a dashboard. */}
            {chat.crm?.is_favorite && (
              <Ionicons
                name="star"
                size={13}
                color={FAVORITE_GOLD}
                accessibilityLabel="Favorite"
                style={styles.favoriteStar}
              />
            )}
            {chat.crm?.priority !== undefined && chat.crm.priority <= 2 && (
              <View
                accessibilityLabel={`Priority ${chat.crm.priority}`}
                style={[styles.priorityDot, { backgroundColor: theme.accent }]}
              />
            )}
            {last && (
              <Text style={[styles.time, { color: theme.textSecondary, fontSize: type.secondary }]}>
                {formatListTimestamp(last.dateCreated)}
              </Text>
            )}
          </View>
          <View style={styles.previewLine}>
            <Text
              numberOfLines={2}
              style={[
                styles.snippet,
                {
                  color: theme.textSecondary,
                  fontSize: compact ? type.secondary : 14,
                  lineHeight: compact ? 16 : 18,
                  fontWeight: chat.flags.unread ? "500" : "400",
                },
              ]}
            >
              {snippet}
            </Text>
            <RowSignal chat={chat} />
          </View>
        </View>
        {compact && (
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
  row: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 80,
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 14,
  },
  separator: {
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    position: "absolute",
    right: 0,
  },
  glideCursor: {
    borderRadius: 2,
    bottom: 14,
    left: 4,
    position: "absolute",
    top: 14,
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
  name: {
    flex: 1,
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
  priorityDot: {
    borderRadius: 3,
    flexShrink: 0,
    height: 6,
    width: 6,
  },
  previewLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    marginTop: 2,
  },
  snippet: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    minWidth: 0,
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
