import { Ionicons } from "@expo/vector-icons";
import type { ChatSummary } from "@shared/types";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { prefetchThread } from "@/hooks/use-messages";
import { useTheme } from "@/hooks/use-theme";
import { Radii } from "@/constants/theme";

import { ChatAvatar } from "./avatar";

interface PriorityShelfProps {
  chats: readonly ChatSummary[];
  selectedGuid?: string;
  onPress: (chat: ChatSummary) => void;
  onLongPress?: (chat: ChatSummary) => void;
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

export const PriorityShelf = forwardRef<PriorityShelfHandle, PriorityShelfProps>(
  function PriorityShelf({ chats, selectedGuid, onPress, onLongPress }, ref) {
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

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`Priority conversations, ${chats.length}`}
      style={[styles.section, { borderBottomColor: theme.divider }]}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
        onLayout={(e) => {
          viewW.current = e.nativeEvent.layout.width;
        }}
        onScroll={(e) => {
          scrollX.current = e.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={16}
      >
        <View style={styles.leadIcon}>
          <Ionicons name="star" size={20} color="#FFCC00" />
        </View>
        {chats.map((chat, index) => {
          const selected = chat.guid === selectedGuid;
          return (
            <Pressable
              key={chat.guid}
              onLayout={(e) => {
                itemFrames.current[index] = {
                  x: e.nativeEvent.layout.x,
                  width: e.nativeEvent.layout.width,
                };
              }}
              accessibilityRole="button"
              accessibilityLabel={`Open ${chat.displayName}, ${unreadLabel(chat)}`}
              accessibilityState={{ selected }}
              onPress={() => onPress(chat)}
              onLongPress={() => onLongPress?.(chat)}
              onPressIn={() => prefetchThread(chat.guid)}
              style={({ pressed }) => [styles.item, { opacity: pressed ? 0.62 : 1 }]}
            >
              <View style={styles.avatarWrap}>
                <ChatAvatar chat={chat} size={58} />
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
              </View>
              <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>
                {chat.displayName}
              </Text>
              <Text numberOfLines={1} style={[styles.meta, { color: theme.textSecondary }]}>
                {unreadLabel(chat)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
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
    width: 66,
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
