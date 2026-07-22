import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary } from "@shared/types";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Reanimated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import { useChatActions } from "@/hooks/use-chat-actions";
import { prefetchThread } from "@/hooks/use-messages";
import { useTheme } from "@/hooks/use-theme";
import { archiveChat, markChatRead, markChatUnread } from "@/lib/chat-actions";
import { formatListTimestamp } from "@/lib/format";
import { useWebContextMenu } from "@/lib/use-web-context-menu";

import { ChatAvatar } from "./avatar";

const ACTION_WIDTH = 84;

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
  const containerStyle = useAnimatedStyle(() => ({
    width: Math.max(ACTION_WIDTH, Math.abs(translation.value)),
  }));
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
        <Ionicons name={icon} size={23} color="#fff" />
        <Text style={styles.swipeActionLabel}>{label}</Text>
      </Reanimated.View>
    </Reanimated.View>
  );
}

export function ChatRow({
  chat,
  selected,
  onPress,
}: {
  chat: ChatSummary;
  selected: boolean;
  onPress: () => void;
  onChanged?: () => void;
}) {
  const theme = useTheme();
  const { openMenu } = useChatActions();
  const { width: winW } = useWindowDimensions();
  const compact = winW >= 768;
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
  const commit = Math.min(190, Math.max(120, winW * 0.42));

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={1}
      leftThreshold={commit}
      rightThreshold={commit}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={(_progress, translation) => (
        <SwipeAction
          translation={translation}
          icon={chat.flags.unread ? "mail-open-outline" : "mail-unread-outline"}
          label={chat.flags.unread ? "Read" : "Unread"}
          color="#0A84FF"
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
          { backgroundColor: selected ? theme.backgroundSelected : pressed ? theme.backgroundElement : theme.background },
        ]}
      >
        <View style={styles.dotColumn}>
          {chat.flags.unread && <View style={[styles.unreadDot, { backgroundColor: theme.accent }]} />}
        </View>
        <ChatAvatar chat={chat} size={52} />
        <View style={styles.content}>
          <View style={styles.topLine}>
            <Text numberOfLines={1} style={[styles.name, { color: theme.text, fontWeight: chat.flags.unread ? "700" : "600" }]}>
              {chat.displayName}
            </Text>
            {last && (
              <Text style={[styles.time, { color: theme.textSecondary }]}>
                {formatListTimestamp(last.dateCreated)}
              </Text>
            )}
          </View>
          <View style={styles.previewLine}>
            <Text
              numberOfLines={2}
              style={[styles.snippet, { color: theme.textSecondary, fontWeight: chat.flags.unread ? "500" : "400" }]}
            >
              {snippet}
            </Text>
            {chat.unreadCount > 0 && (
              <View style={[styles.unreadBadge, { backgroundColor: theme.accent }]}>
                <Text style={styles.unreadBadgeText}>{chat.unreadCount > 99 ? "99+" : chat.unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
        {compact && (
          <Pressable
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
              name={chat.flags.archived ? "arrow-undo-outline" : "checkmark"}
              size={16}
              color={theme.text}
            />
          </Pressable>
        )}
      </Pressable>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 75,
    paddingRight: 16,
  },
  dotColumn: {
    alignItems: "center",
    width: 17,
  },
  unreadDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  content: {
    flex: 1,
    marginLeft: 11,
    minWidth: 0,
    paddingVertical: 10,
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
  unreadBadge: {
    alignItems: "center",
    borderRadius: 10,
    height: 19,
    justifyContent: "center",
    minWidth: 19,
    paddingHorizontal: 5,
  },
  unreadBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  hoverArchive: {
    position: "absolute",
    right: 10,
    top: "50%",
    marginTop: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
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
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
});
