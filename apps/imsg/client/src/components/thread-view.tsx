import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Reanimated, { FadeInDown } from "react-native-reanimated";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { api } from "@/lib/api";
import { formatDayDivider, sameDay } from "@/lib/format";
import { useServerEvents } from "@/lib/sse";
import { useActionSheet } from "@/lib/action-sheet";
import { setForwardText } from "@/lib/forward";
import { Pressable } from "react-native";
import type { Message } from "@shared/types";
import { useMessages, type JumpTarget } from "@/hooks/use-messages";
import { usePrivateApi } from "@/hooks/use-health";
import { useTheme } from "@/hooks/use-theme";
import { showToast } from "@/lib/toast";
import { patchChatWithMessage } from "@/lib/chat-store";
import type { ChatSummary } from "@shared/types";
import { Bubble, TAPBACK_EMOJI } from "./bubble";
import { ChatAvatar } from "./avatar";
import { Composer } from "./composer";

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const UNSEND_WINDOW_MS = 2 * 60 * 1000;
const GROUP_GAP_MS = 10 * 60 * 1000;

interface Row {
  message: Message;
  groupStart: boolean;
  groupEnd: boolean;
  newDay: boolean;
}

interface ThreadViewProps {
  chatGuid: string;
  isGroup: boolean;
  jumpTarget?: JumpTarget | null;
  headerOffset?: number;
  /** When set (wide split-pane), render an in-pane header for this chat. */
  headerChat?: ChatSummary | null;
}

export function ThreadView({
  chatGuid,
  isGroup,
  jumpTarget = null,
  headerOffset = 0,
  headerChat = null,
}: ThreadViewProps) {
  const theme = useTheme();
  const privateApi = usePrivateApi();
  const showSheet = useActionSheet();
  const { messages, loading, hasMore, loadOlder, loadNewer, upsert, replaceTemp } = useMessages(
    chatGuid,
    jumpTarget,
  );
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [highlightGuid, setHighlightGuid] = useState<string | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [dayChip, setDayChip] = useState<string | null>(null);
  const dayChipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // FlatList requires stable identities for viewability callbacks.
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10 }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: unknown }> }) => {
      const top = viewableItems[viewableItems.length - 1];
      const row = top?.item as Row | undefined;
      if (!row) return;
      setDayChip(formatDayDivider(row.message.dateCreated));
      if (dayChipTimer.current) clearTimeout(dayChipTimer.current);
      dayChipTimer.current = setTimeout(() => setDayChip(null), 1200);
    },
  ).current;
  const typingClear = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<Row>>(null);

  useEffect(() => {
    setReplyTo(null);
    setEditing(null);
    void api.markRead(chatGuid);
  }, [chatGuid]);


  // Web: RNW's inverted-list wheel handling is broken (reversed / inert), so
  // drive the scroll ourselves. Inverted container ⇒ wheel-up must increase
  // scrollTop (toward older messages).
  const [listMounted, setListMounted] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web" || !listMounted) return;
    const node = (
      listRef.current as unknown as { getScrollableNode?: () => HTMLElement } | null
    )?.getScrollableNode?.();
    if (!node || typeof node.addEventListener !== "function") return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      node.scrollTop -= event.deltaY;
    };
    node.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => node.removeEventListener("wheel", onWheel, { capture: true });
  }, [listMounted]);

  useServerEvents(
    useCallback(
      (event) => {
        if (
          (event.kind === "new-message" || event.kind === "updated-message") &&
          event.chatGuid === chatGuid
        ) {
          upsert(event.message);
          if (event.kind === "new-message" && !event.message.isFromMe) {
            void api.markRead(chatGuid);
            setPeerTyping(false);
          }
        } else if (event.kind === "typing" && event.chatGuid === chatGuid) {
          setPeerTyping(event.display);
          if (typingClear.current) clearTimeout(typingClear.current);
          if (event.display) {
            typingClear.current = setTimeout(() => setPeerTyping(false), 12000);
          }
        }
      },
      [chatGuid, upsert],
    ),
  );

  const rows = useMemo<Row[]>(() => {
    const visible = messages.filter((m) => !m.isGroupEvent || m.text);
    const built = visible.map((message, index) => {
      const prev = visible[index - 1];
      const next = visible[index + 1];
      const newDay = !prev || !sameDay(prev.dateCreated, message.dateCreated);
      const samePrev =
        prev !== undefined &&
        !newDay &&
        prev.isFromMe === message.isFromMe &&
        prev.sender?.address === message.sender?.address &&
        message.dateCreated - prev.dateCreated < GROUP_GAP_MS;
      const sameNext =
        next !== undefined &&
        sameDay(next.dateCreated, message.dateCreated) &&
        next.isFromMe === message.isFromMe &&
        next.sender?.address === message.sender?.address &&
        next.dateCreated - message.dateCreated < GROUP_GAP_MS;
      return { message, groupStart: !samePrev, groupEnd: !sameNext, newDay };
    });
    return built.reverse(); // inverted list renders newest first
  }, [messages]);

  // Jump-to-message: once the around-window loads, scroll the target into view.
  const jumped = useRef<string | null>(null);
  useEffect(() => {
    if (!jumpTarget || rows.length === 0 || jumped.current === jumpTarget.guid) return;
    const index = rows.findIndex((r) => r.message.guid === jumpTarget.guid);
    if (index < 0) return;
    jumped.current = jumpTarget.guid;
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
      setHighlightGuid(jumpTarget.guid);
      setTimeout(() => setHighlightGuid(null), 2600);
    }, 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget, rows]);

  // Open at the first unread message when there are several (iMessage behavior).
  const unreadScrolled = useRef(false);
  const firstUnreadAt = headerChat?.firstUnreadAt ?? null;
  useEffect(() => {
    if (jumpTarget || unreadScrolled.current || !firstUnreadAt || rows.length === 0) return;
    const unreadCount = rows.filter((r) => !r.message.isFromMe && r.message.dateCreated >= firstUnreadAt).length;
    if (unreadCount < 4) {
      unreadScrolled.current = true;
      return;
    }
    // rows are newest-first (inverted); the oldest unread is the highest index.
    let target = -1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r && r.message.dateCreated >= firstUnreadAt) target = i;
    }
    if (target >= 0) {
      unreadScrolled.current = true;
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: target, viewPosition: 0.8, animated: false });
      }, 150);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstUnreadAt, rows, jumpTarget]);

  const latestOutgoingGuid = useMemo(
    () => rows.find((r) => r.message.isFromMe && !r.message.pending && !r.message.failed)?.message.guid ?? null,
    [rows],
  );

  const retry = useCallback(
    (failed: Message) => {
      const revived: Message = { ...failed, pending: true, failed: false };
      replaceTemp(failed.guid, revived);
      api
        .sendText(chatGuid, { text: failed.text, replyToGuid: failed.replyToGuid ?? undefined })
        .then((message) => replaceTemp(revived.guid, message))
        .catch(() => replaceTemp(revived.guid, { ...revived, pending: false, failed: true }));
    },
    [chatGuid, replaceTemp],
  );

  const showReactions = useCallback(
    (message: Message) => {
      showSheet({
        title: "Reactions",
        actions: message.reactions.map((r) => ({
          label: `${TAPBACK_EMOJI.get(r.type) ?? r.type}  ${r.isFromMe ? "You" : (r.senderName ?? r.senderAddress ?? "Unknown")}`,
          onPress: () => undefined,
        })),
      });
    },
    [showSheet],
  );

  const openMessageSheet = useCallback(
    (message: Message) => {
      const mine = message.isFromMe;
      const age = Date.now() - message.dateCreated;
      const tapbacks = privateApi
        ? [...TAPBACK_EMOJI.entries()].map(([type, emoji]) => {
            const active = message.reactions.some((r) => r.isFromMe && r.type === type);
            return {
              emoji,
              active,
              onPress: () => {
                void api
                  .react(message.guid, { chatGuid, reaction: type, remove: active })
                  .catch(() => showToast("Reaction failed"));
              },
            };
          })
        : undefined;
      const actions = [
        ...(privateApi ? [{ label: "Reply", onPress: () => setReplyTo(message) }] : []),
        ...(message.text
          ? [
              {
                label: "Copy",
                onPress: () => {
                  void Clipboard.setStringAsync(message.text).then(() => showToast("Copied"));
                },
              },
              {
                label: "Forward",
                onPress: () => {
                  setForwardText(message.text);
                  router.push("/forward");
                },
              },
            ]
          : []),
        ...(mine && privateApi && message.text && age < EDIT_WINDOW_MS && !message.pending
          ? [{ label: "Edit", onPress: () => setEditing(message) }]
          : []),
        ...(mine && privateApi && age < UNSEND_WINDOW_MS && !message.pending
          ? [
              {
                label: "Unsend",
                destructive: true,
                onPress: () => {
                  void api
                    .unsend(message.guid)
                    .then(() => upsert({ ...message, retracted: true }))
                    .catch(() => showToast("Unsend failed — messages can only be unsent for ~2 minutes"));
                },
              },
            ]
          : []),
      ];
      if (actions.length > 0 || tapbacks) showSheet({ actions, tapbacks });
    },
    [chatGuid, privateApi, showSheet, upsert],
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerOffset}
    >
      {headerChat && (
        <View
          style={[
            styles.paneHeader,
            { backgroundColor: theme.background, borderBottomColor: theme.divider },
          ]}
        >
          <View style={styles.paneHeaderSpace} />
          <View style={styles.paneIdentity}>
            <ChatAvatar chat={headerChat} size={32} />
            <View style={styles.paneIdentityText}>
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>
                {headerChat.displayName}
              </Text>
              {headerChat.isGroup && (
                <Text style={{ color: theme.textSecondary, fontSize: 11 }}>
                  {headerChat.participants.length} people
                </Text>
              )}
            </View>
          </View>
          <View style={[styles.paneHeaderSpace, styles.paneHeaderActions]}>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/search",
                  params: { chat: chatGuid, name: headerChat.displayName },
                })
              }
              hitSlop={8}
            >
              <Ionicons name="search" size={21} color={theme.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => router.push({ pathname: "/chat-info", params: { guid: chatGuid } })}
              hitSlop={8}
            >
              <Ionicons name="information-circle-outline" size={24} color={theme.textSecondary} />
            </Pressable>
          </View>
        </View>
      )}
      {loading && messages.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          ref={(ref) => {
            (listRef as React.MutableRefObject<FlatList<Row> | null>).current = ref;
            if (ref && !listMounted) setListMounted(true);
          }}
          data={rows}
          inverted
          keyExtractor={(row) => row.message.guid}
          onEndReached={() => {
            if (hasMore && !loading) loadOlder();
          }}
          onEndReachedThreshold={0.4}
          onStartReached={() => loadNewer()}
          onStartReachedThreshold={0.2}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
          }}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          contentContainerStyle={{ paddingVertical: 10 }}
          ListHeaderComponent={
            peerTyping ? (
              <View style={styles.typingRow}>
                <View style={[styles.typingBubble, { backgroundColor: theme.bubbleTheirs }]}>
                  <TypingDots color={theme.textSecondary} />
                </View>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Reanimated.View
              entering={
                Date.now() - item.message.dateCreated < 4000 ? FadeInDown.springify().damping(18) : undefined
              }
            >
              {item.newDay && (
                <Text style={[styles.dayDivider, { color: theme.textSecondary }]}>
                  {formatDayDivider(item.message.dateCreated)}
                </Text>
              )}
              {item.message.isGroupEvent ? (
                <Text style={[styles.groupEvent, { color: theme.textSecondary }]}>
                  {item.message.text}
                </Text>
              ) : (
                <Bubble
                  message={item.message}
                  groupStart={item.groupStart}
                  groupEnd={item.groupEnd}
                  isGroupChat={isGroup}
                  isLatestOutgoing={item.message.guid === latestOutgoingGuid}
                  highlighted={item.message.guid === highlightGuid}
                  onLongPress={openMessageSheet}
                  onRetry={retry}
                  onShowReactions={showReactions}
                />
              )}
            </Reanimated.View>
          )}
        />
      )}
      {dayChip && (
        <View
          pointerEvents="none"
          style={[styles.dayChipWrap, headerChat && styles.dayChipWrapWithHeader]}
        >
          <View style={[styles.dayChip, { backgroundColor: theme.backgroundElement }]}>
            <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "600" }}>
              {dayChip}
            </Text>
          </View>
        </View>
      )}
      <Composer
        chatGuid={chatGuid}
        replyTo={replyTo}
        editing={editing}
        onClearReply={() => setReplyTo(null)}
        onClearEditing={() => setEditing(null)}
        onEdited={upsert}
        onOptimistic={(message) => {
          upsert(message);
          patchChatWithMessage(chatGuid, message);
        }}
        onSettled={(tempGuid, message) => {
          replaceTemp(tempGuid, message);
          if (!message.failed) patchChatWithMessage(chatGuid, message);
        }}
        onSent={(message) => {
          upsert(message);
          patchChatWithMessage(chatGuid, message);
        }}
      />
    </KeyboardAvoidingView>
  );
}

function TypingDots({ color }: { color: string }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setPhase((p) => (p + 1) % 3), 350);
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={{ flexDirection: "row", gap: 4, paddingVertical: 6, paddingHorizontal: 2 }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: color,
            opacity: phase === i ? 1 : 0.35,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  paneHeader: {
    height: 58,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  paneHeaderSpace: {
    flex: 1,
  },
  paneHeaderActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 14,
  },
  paneIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: "70%",
  },
  paneIdentityText: {
    flexShrink: 1,
  },
  dayChipWrap: {
    position: "absolute",
    top: 10,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  dayChipWrapWithHeader: {
    top: 68,
  },
  dayChip: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  typingRow: {
    paddingHorizontal: 42,
    paddingVertical: 6,
    alignItems: "flex-start",
  },
  typingBubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayDivider: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: "500",
    marginVertical: 12,
  },
  groupEvent: {
    textAlign: "center",
    fontSize: 12,
    marginVertical: 6,
    paddingHorizontal: 20,
  },
});
