import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Reanimated, { FadeInDown } from "react-native-reanimated";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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
import { onOpenThreadSearch } from "@/lib/thread-search";
import { openChatInfo } from "@/lib/chat-info";
import { openPersonPane } from "@/lib/person-pane";
import type { Message } from "@shared/types";
import { useMessages, type JumpTarget } from "@/hooks/use-messages";
import { usePrivateApi } from "@/hooks/use-health";
import { useTheme } from "@/hooks/use-theme";
import { showToast } from "@/lib/toast";
import { patchChatWithMessage } from "@/lib/chat-store";
import type { ChatSummary } from "@shared/types";
import { useAiStatus } from "@/hooks/use-ai";
import { Bubble, TAPBACK_EMOJI } from "./bubble";
import { ChatAvatar, GroupAvatarStack } from "./avatar";
import { Composer } from "./composer";
import { SuggestionShelf } from "./suggestion-shelf";

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
  /** Glide-mode preview: render without marking the conversation read. */
  previewOnly?: boolean;
  /** When provided (desktop split-pane with AI shadow available), show the toggle. */
  onToggleShadow?: () => void;
  shadowOpen?: boolean;
}

export function ThreadView({
  chatGuid,
  isGroup,
  jumpTarget = null,
  headerOffset = 0,
  headerChat = null,
  previewOnly = false,
  onToggleShadow,
  shadowOpen = false,
}: ThreadViewProps) {
  const theme = useTheme();
  const privateApi = usePrivateApi();
  const aiStatus = useAiStatus();
  const showSheet = useActionSheet();
  const messagesRef = useRef<Message[]>([]);
  const { messages, loading, hasMore, loadOlder, loadNewer, upsert, replaceTemp } = useMessages(
    chatGuid,
    jumpTarget,
  );
  messagesRef.current = messages;
  // Milad owes a reply when the newest real message is inbound. Drives whether
  // the suggestion shelf appears at all.
  const awaitingReply = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m || m.isGroupEvent) continue;
      return !m.isFromMe;
    }
    return false;
  }, [messages]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [highlightGuid, setHighlightGuid] = useState<string | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
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
    setSearchOpen(false);
    setSearchText("");
    // Preview (glide-mode j/k) must not mark read; activation ("reply") does.
    if (!previewOnly) void api.markRead(chatGuid);
  }, [chatGuid, previewOnly]);

  // Header search buttons open the in-thread search shelf via a signal bus.
  useEffect(() => onOpenThreadSearch(() => setSearchOpen(true)), []);


  // Web: RNW's inverted-list wheel handling is broken (reversed / inert), so
  // drive the scroll ourselves. Inverted container ⇒ wheel-up must increase
  // scrollTop (toward older messages).
  const [listMounted, setListMounted] = useState(false);
  const [paneW, setPaneW] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "web" || !listMounted) return;
    const node = (
      listRef.current as unknown as { getScrollableNode?: () => HTMLElement } | null
    )?.getScrollableNode?.();
    if (!node || typeof node.addEventListener !== "function") return;
    // Reserve the scrollbar gutter HERE (not globally — see post-export.ts) so
    // short and long conversations align identically.
    node.style.scrollbarGutter = "stable";
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
            if (!previewOnly) void api.markRead(chatGuid);
            setPeerTyping(false);
          }
        } else if (event.kind === "reaction" && event.chatGuid === chatGuid) {
          // Fold the tapback into its target message live — same shape the
          // server produces on reload — instead of rendering a "Loved …" row.
          const target = messagesRef.current.find((m) => m.guid === event.targetGuid);
          if (target) {
            const sameSender = (r: (typeof target.reactions)[number]) =>
              event.reaction.isFromMe
                ? r.isFromMe
                : !r.isFromMe && r.senderAddress === event.reaction.senderAddress;
            const rest = target.reactions.filter(
              (r) => !(sameSender(r) && r.type === event.reaction.type),
            );
            upsert({
              ...target,
              reactions: event.remove ? rest : [...rest, event.reaction],
            });
          }
        } else if (event.kind === "typing" && event.chatGuid === chatGuid) {
          setPeerTyping(event.display);
          if (typingClear.current) clearTimeout(typingClear.current);
          if (event.display) {
            typingClear.current = setTimeout(() => setPeerTyping(false), 12000);
          }
        }
      },
      [chatGuid, upsert, previewOnly],
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

  // In-thread search matches within the loaded window (newest-first `rows`).
  const searchMatches = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    if (needle.length < 2) return [] as number[];
    return rows.reduce<number[]>((acc, r, i) => {
      if (r.message.text.toLowerCase().includes(needle)) acc.push(i);
      return acc;
    }, []);
  }, [rows, searchText]);

  useEffect(() => setMatchIndex(0), [searchText]);

  // Scroll to and highlight the current match as you step through them.
  useEffect(() => {
    if (!searchOpen || searchMatches.length === 0) return;
    const idx = searchMatches[Math.min(matchIndex, searchMatches.length - 1)];
    if (idx === undefined) return;
    const guid = rows[idx]?.message.guid ?? null;
    listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.5, animated: true });
    setHighlightGuid(guid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, searchMatches, matchIndex]);

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
    (message: Message, anchor?: { x: number; y: number }) => {
      const mine = message.isFromMe;
      const age = Date.now() - message.dateCreated;
      const tapbacks = privateApi
        ? [...TAPBACK_EMOJI.entries()].map(([type, emoji]) => {
            const active = message.reactions.some((r) => r.isFromMe && r.type === type);
            return {
              emoji,
              active,
              onPress: () => {
                // Optimistic: show my reaction immediately; revert on failure.
                const reactions = active
                  ? message.reactions.filter((r) => !(r.isFromMe && r.type === type))
                  : [
                      ...message.reactions,
                      { type, isFromMe: true, senderName: null, senderAddress: null },
                    ];
                upsert({ ...message, reactions });
                void api.react(message.guid, { chatGuid, reaction: type, remove: active }).catch(() => {
                  upsert(message);
                  showToast("Reaction failed");
                });
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
        // "Remove for you" — deletes locally (Mac's Messages DB), any age,
        // either side. The tool for clearing failed/Not Delivered sends.
        ...(privateApi && !message.pending
          ? [
              {
                label: "Delete for Me",
                destructive: true,
                onPress: () => {
                  void api
                    .deleteMessage(message.guid, chatGuid)
                    .then(() => {
                      upsert({ ...message, retracted: true });
                      showToast("Deleted");
                    })
                    .catch(() => showToast("Delete failed"));
                },
              },
            ]
          : []),
      ];
      if (actions.length > 0 || tapbacks) showSheet({ actions, tapbacks, anchor });
    },
    [chatGuid, privateApi, showSheet, upsert],
  );

  return (
    <KeyboardAvoidingView
      onLayout={(e) => setPaneW(e.nativeEvent.layout.width)}
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
          <Pressable
            style={styles.paneIdentity}
            onPress={() => {
              if (headerChat.isGroup) {
                openChatInfo(chatGuid);
              } else {
                const p = headerChat.participants[0];
                if (p) openPersonPane({ address: p.address, name: headerChat.displayName, backGuid: chatGuid });
              }
            }}
          >
            {headerChat.isGroup ? (
              <GroupAvatarStack chat={headerChat} size={34} />
            ) : (
              <ChatAvatar chat={headerChat} size={32} />
            )}
            <View style={styles.paneIdentityText}>
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: 16, fontWeight: "600" }}>
                {headerChat.displayName}
              </Text>
              {headerChat.isGroup && (
                <Text style={{ color: theme.textSecondary, fontSize: 11 }}>
                  {headerChat.participants.length} people ›
                </Text>
              )}
            </View>
          </Pressable>
          <View style={[styles.paneHeaderSpace, styles.paneHeaderActions]}>
            <Pressable onPress={() => setSearchOpen(true)} hitSlop={8}>
              <Ionicons name="search" size={21} color={theme.textSecondary} />
            </Pressable>
            {onToggleShadow && (
              <Pressable onPress={onToggleShadow} hitSlop={8}>
                <Ionicons
                  name={shadowOpen ? "sparkles" : "sparkles-outline"}
                  size={21}
                  color={shadowOpen ? theme.accent : theme.textSecondary}
                />
              </Pressable>
            )}
            <Pressable
              onPress={() => openChatInfo(chatGuid)}
              hitSlop={8}
            >
              <Ionicons name="information-circle-outline" size={24} color={theme.textSecondary} />
            </Pressable>
          </View>
        </View>
      )}

      {searchOpen && (
        <View style={[styles.searchShelf, { backgroundColor: theme.backgroundElement, borderBottomColor: theme.divider }]}>
          <View style={[styles.searchField, { backgroundColor: theme.background }]}>
            <Ionicons name="search" size={16} color={theme.textSecondary} />
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Search this conversation"
              placeholderTextColor={theme.textSecondary}
              autoFocus
              style={[styles.searchInput, { color: theme.text }]}
            />
            {searchText.trim().length >= 2 && (
              <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                {searchMatches.length === 0 ? "0" : `${matchIndex + 1}/${searchMatches.length}`}
              </Text>
            )}
          </View>
          <Pressable
            disabled={searchMatches.length === 0}
            onPress={() => setMatchIndex((i) => (i + 1) % searchMatches.length)}
            hitSlop={6}
          >
            <Ionicons name="chevron-up" size={22} color={searchMatches.length ? theme.accent : theme.textSecondary} />
          </Pressable>
          <Pressable
            disabled={searchMatches.length === 0}
            onPress={() => setMatchIndex((i) => (i - 1 + searchMatches.length) % searchMatches.length)}
            hitSlop={6}
          >
            <Ionicons name="chevron-down" size={22} color={searchMatches.length ? theme.accent : theme.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => {
              setSearchOpen(false);
              setSearchText("");
              setHighlightGuid(null);
            }}
            hitSlop={6}
          >
            <Text style={{ color: theme.accent, fontSize: 15 }}>Done</Text>
          </Pressable>
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
                  paneWidth={paneW}
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
          style={[styles.dayChipWrap, headerChat && styles.dayChipWrapWithHeader, searchOpen && styles.dayChipWrapWithSearch]}
        >
          <View style={[styles.dayChip, { backgroundColor: theme.backgroundElement }]}>
            <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "600" }}>
              {dayChip}
            </Text>
          </View>
        </View>
      )}
      <SuggestionShelf
        chatGuid={chatGuid}
        enabled={aiStatus?.suggestions === true && !editing}
        awaitingReply={awaitingReply}
      />
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
    paddingHorizontal: 16,
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
  searchShelf: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchField: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
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
  // The in-thread search shelf sits above the scroll — push the chip below it.
  dayChipWrapWithSearch: {
    top: 120,
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
