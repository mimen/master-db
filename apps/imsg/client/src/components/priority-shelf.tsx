import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary } from "@shared/types";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";

import { prefetchThread } from "@/hooks/use-messages";
import { useTheme } from "@/hooks/use-theme";
import { Radii } from "@/constants/theme";

import { ChatAvatar } from "./avatar";

interface PriorityShelfProps {
  chats: readonly ChatSummary[];
  selectedGuid?: string;
  onPress: (chat: ChatSummary) => void;
  onLongPress?: (chat: ChatSummary) => void;
  /** "strip" is the desktop title-row faces. "full" is the labeled iOS shelf. */
  variant?: "full" | "strip";
}

/** Narrow imperative surface for keyboard glide: the shelf owns its own
 * horizontal visibility, mirroring the vertical viewport's edge-pinning. */
export interface PriorityShelfHandle {
  reveal(index: number, direction: -1 | 1): void;
}

function unreadLabel(chat: ChatSummary): string {
  if (chat.unreadCount === 0) return "Unread";
  return chat.unreadCount === 1 ? "1 unread" : `${chat.unreadCount} unread`;
}

/** The shelf now admits P1/P2 chats with zero unread (see chat-state.ts's
 * partitionPriorityShelf) — those entries have nothing truthful to say via
 * unreadLabel, so show which priority earned them the slot instead. Falls
 * back to unreadLabel for everything else (the common case: unread chats,
 * with or without priority). */
function shelfMeta(chat: ChatSummary): { text: string; isPriorityBadge: boolean } {
  if (chat.unreadCount === 0 && (chat.crm?.priority === 1 || chat.crm?.priority === 2)) {
    return { text: `P${chat.crm.priority}`, isPriorityBadge: true };
  }
  return { text: unreadLabel(chat), isPriorityBadge: false };
}

export const PriorityShelf = forwardRef<PriorityShelfHandle, PriorityShelfProps>(
  function PriorityShelf({ chats, selectedGuid, onPress, onLongPress, variant = "full" }, ref) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  // Measured per-item frames (x/width relative to the scroll content) — the
  // shelf can hold ten conversations in a 380px sidebar, so a keyboard
  // selection past the fold must be scrolled into view.
  const itemFrames = useRef<Array<{ x: number; width: number }>>([]);
  const viewW = useRef(0);
  const scrollX = useRef(0);

  useImperativeHandle(ref, () => ({
    reveal(index, direction) {
      const frame = itemFrames.current[index];
      if (!frame || viewW.current <= 0) return;
      const pad = 18;
      const visibleStart = scrollX.current;
      const visibleEnd = scrollX.current + viewW.current;
      if (frame.x >= visibleStart + pad && frame.x + frame.width <= visibleEnd - pad) return;
      // Edge-pin toward the direction of travel, like the vertical list.
      const x =
        direction > 0
          ? frame.x + frame.width - viewW.current + pad
          : frame.x - pad;
      scrollRef.current?.scrollTo({ x: Math.max(0, x), animated: false });
    },
  }));

  if (chats.length === 0) return null;

  const strip = variant === "strip";
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`Priority conversations, ${chats.length}`}
      style={strip ? styles.strip : [styles.section, { borderBottomColor: theme.divider }]}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={strip ? styles.stripContent : styles.content}
        onLayout={(e) => {
          viewW.current = e.nativeEvent.layout.width;
        }}
        onScroll={(e) => {
          scrollX.current = e.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={16}
      >
        {strip ? null : (
          <View style={styles.leadIcon}>
            <Ionicons name="star" size={20} color="#FFCC00" />
          </View>
        )}
        {chats.map((chat, index) => (
          <PriorityItem
            key={chat.guid}
            chat={chat}
            selected={chat.guid === selectedGuid}
            strip={strip}
            onLayout={(e) => {
              itemFrames.current[index] = {
                x: e.nativeEvent.layout.x,
                width: e.nativeEvent.layout.width,
              };
            }}
            onPress={() => onPress(chat)}
            onLongPress={() => onLongPress?.(chat)}
          />
        ))}
      </ScrollView>
    </View>
  );
});

function PriorityItem({
  chat,
  selected,
  strip,
  onLayout,
  onPress,
  onLongPress,
}: {
  chat: ChatSummary;
  selected: boolean;
  strip: boolean;
  onLayout: (event: LayoutChangeEvent) => void;
  onPress: () => void;
  onLongPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const meta = shelfMeta(chat);
  const avatar = strip ? 26 : 58;
  return (
    <Pressable
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel={`Open ${chat.displayName}, ${
        meta.isPriorityBadge ? `priority ${chat.crm!.priority}` : meta.text
      }`}
      accessibilityState={{ selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => prefetchThread(chat.guid)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        strip ? styles.stripItem : styles.item,
        hovered && !pressed && !strip && { backgroundColor: theme.backgroundElement },
        pressed && !strip && { backgroundColor: theme.backgroundSelected },
        Platform.OS === "web" ? ({ cursor: "pointer" } as object) : null,
      ]}
    >
      <View
        style={
          strip
            ? [
                styles.stripAvatar,
                { borderColor: selected ? theme.accent : hovered ? theme.divider : "transparent" },
              ]
            : styles.avatarWrap
        }
      >
        <ChatAvatar chat={chat} size={avatar} />
        {strip ? null : (
          <View
            style={[
              styles.status,
              {
                backgroundColor: selected ? theme.accent : theme.background,
                borderColor: theme.background,
              },
            ]}
          >
            <Ionicons name="ellipse" size={8} color={selected ? theme.onAccent : theme.accent} />
          </View>
        )}
      </View>
      {strip ? null : (
        <>
          <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>
            {chat.displayName}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.meta, { color: meta.isPriorityBadge ? theme.accent : theme.textSecondary }]}
          >
            {meta.text}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    flex: 1,
    minWidth: 0,
  },
  stripContent: {
    alignItems: "center",
    gap: 6,
    paddingRight: 4,
  },
  stripItem: {
    borderRadius: 16,
  },
  stripAvatar: {
    borderRadius: 16,
    borderWidth: 2,
    padding: 1,
  },
  section: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 20,
    paddingTop: 12,
  },
  content: {
    alignItems: "flex-start",
    gap: 18,
    paddingHorizontal: 18,
  },
  leadIcon: {
    alignItems: "center",
    height: 58,
    justifyContent: "center",
    marginRight: -4,
    width: 22,
  },
  item: {
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 4,
    paddingVertical: 6,
    width: 74,
  },
  avatarWrap: {
    marginBottom: 6,
    position: "relative",
  },
  status: {
    alignItems: "center",
    borderRadius: Radii.chip,
    borderWidth: 2,
    bottom: -2,
    height: 19,
    justifyContent: "center",
    position: "absolute",
    right: -2,
    width: 19,
  },
  name: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    width: 76,
  },
  meta: {
    fontSize: 11,
    marginTop: 1,
    textAlign: "center",
    width: 76,
  },
});
