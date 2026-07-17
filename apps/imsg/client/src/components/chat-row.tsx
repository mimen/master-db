import { Pressable, StyleSheet, Text, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Reanimated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { api } from "@/lib/api";
import { formatListTimestamp } from "@/lib/format";
import type { ChatSummary } from "@/lib/types";
import { useActionSheet } from "@/lib/action-sheet";
import { useTheme } from "@/hooks/use-theme";
import { showToast } from "@/lib/toast";
import { useWebContextMenu } from "@/lib/use-web-context-menu";
import { prefetchThread } from "@/hooks/use-messages";
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
  onChanged,
}: {
  chat: ChatSummary;
  selected: boolean;
  onPress: () => void;
  onChanged: () => void;
}) {
  const theme = useTheme();
  const showSheet = useActionSheet();
  const last = chat.lastMessage;
  const snippet = last
    ? `${last.isFromMe ? "You: " : chat.isGroup && last.senderName ? `${last.senderName.split(" ")[0]}: ` : ""}${
        last.text || (last.hasAttachments ? "Attachment" : "")
      }`
    : "";

  const run = (action: Promise<unknown>) => {
    void action.then(onChanged).catch(() => {
      showToast("Action failed");
      onChanged();
    });
  };

  const contextRef = useWebContextMenu<typeof Pressable>(() => openMenu());

  const openMenu = () => {
    const actions = [
      chat.flags.unread
        ? { label: "Mark as read", onPress: () => run(api.markRead(chat.guid)) }
        : { label: "Mark as unread", onPress: () => run(api.markUnread(chat.guid)) },
      ...(chat.flags.unresponded
        ? [{ label: "No reply needed", onPress: () => run(api.dismiss(chat.guid, "unresponded")) }]
        : []),
      ...(chat.flags.waiting
        ? [{ label: "Not waiting on this", onPress: () => run(api.dismiss(chat.guid, "waiting")) }]
        : []),
      chat.flags.archived
        ? { label: "Unarchive", onPress: () => run(api.setArchived(chat.guid, false)) }
        : { label: "Archive", destructive: true, onPress: () => run(api.setArchived(chat.guid, true)) },
      ...(chat.isGroup
        ? [
            {
              label: chat.flags.mutedUnresponded ? "Show in Unresponded" : "Hide from Unresponded",
              onPress: () => run(api.setMuted(chat.guid, !chat.flags.mutedUnresponded)),
            },
          ]
        : []),
    ];
    showSheet({ title: chat.displayName, actions });
  };

  return (
    <ReanimatedSwipeable
      friction={1.6}
      leftThreshold={ACTION_WIDTH * 0.75}
      rightThreshold={ACTION_WIDTH * 0.75}
      overshootFriction={4}
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
      onSwipeableWillOpen={(direction) => {
        if (direction === "left") {
          run(chat.flags.unread ? api.markRead(chat.guid) : api.markUnread(chat.guid));
        } else {
          run(api.setArchived(chat.guid, !chat.flags.archived));
        }
      }}
    >
      <Pressable
        ref={contextRef as never}
        onPress={onPress}
        onPressIn={() => prefetchThread(chat.guid)}
        onHoverIn={() => prefetchThread(chat.guid)}
        onLongPress={openMenu}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: selected ? theme.backgroundSelected : pressed ? theme.backgroundElement : theme.background },
        ]}
      >
        <View style={styles.dotColumn}>
          {chat.flags.unread && <View style={styles.unreadDot} />}
        </View>
        <ChatAvatar chat={chat} size={52} />
        <View style={styles.content}>
          <View style={styles.topLine}>
            <Text
              numberOfLines={1}
              style={[styles.name, { color: theme.text, fontWeight: chat.flags.unread ? "700" : "600" }]}
            >
              {chat.displayName}
            </Text>
            {last && (
              <Text style={[styles.time, { color: theme.textSecondary }]}>
                {formatListTimestamp(last.dateCreated)}
              </Text>
            )}
          </View>
          <Text numberOfLines={2} style={[styles.snippet, { color: theme.textSecondary }]}>
            {snippet}
          </Text>
        </View>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    paddingRight: 16,
    gap: 10,
  },
  dotColumn: {
    width: 16,
    alignItems: "center",
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#0A84FF",
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  topLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 8,
  },
  name: {
    fontSize: 17,
    flexShrink: 1,
  },
  time: {
    fontSize: 15,
  },
  snippet: {
    fontSize: 15,
    lineHeight: 19,
    marginTop: 1,
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
