import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary } from "@shared/types";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Reanimated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { useChatActions } from "@/hooks/use-chat-actions";
import { prefetchThread } from "@/hooks/use-messages";
import { useTheme } from "@/hooks/use-theme";
import { archiveChat, markChatRead, markChatUnread } from "@/lib/chat-actions";
import { formatListTimestamp } from "@/lib/format";
import { useWebContextMenu } from "@/lib/use-web-context-menu";

import { ChatAvatar } from "./avatar";

const ACTION_WIDTH = 84;

function SwipeAction({
  progress,
  label,
  color,
  side,
}: {
  progress: SharedValue<number>;
  label: string;
  color: string;
  side: "left" | "right";
}) {
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 1.5),
  }));
  return (
    <Reanimated.View
      style={[
        styles.swipeAction,
        { backgroundColor: color, alignItems: side === "left" ? "flex-start" : "flex-end" },
        style,
      ]}
    >
      <Text style={styles.swipeActionLabel}>{label}</Text>
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

  const contextRef = useWebContextMenu<typeof Pressable>(() => openMenu(chat));

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

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={1.6}
      leftThreshold={ACTION_WIDTH * 0.6}
      rightThreshold={ACTION_WIDTH * 0.6}
      overshootFriction={8}
      renderLeftActions={(progress) => (
        <SwipeAction
          progress={progress}
          label={chat.flags.unread ? "Read" : "Unread"}
          color="#0A84FF"
          side="left"
        />
      )}
      renderRightActions={(progress) => (
        <SwipeAction progress={progress} label="Archive" color="#F0A500" side="right" />
      )}
      onSwipeableOpen={(direction) => {
        // Fire the optimistic action, then snap the row shut — the store patch
        // moves the chat out of the current filter immediately.
        if (direction === "left") {
          if (chat.flags.unread) markChatRead(chat);
          else markChatUnread(chat);
        } else {
          archiveChat(chat, !chat.flags.archived);
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
    paddingHorizontal: 18,
  },
  swipeActionLabel: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
