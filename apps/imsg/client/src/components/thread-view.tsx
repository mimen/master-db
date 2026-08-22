import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Reanimated, { FadeInUp } from "react-native-reanimated";
import {
  FlatList,
  Keyboard,
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
import { hapticSelect } from "@/lib/haptics";
import { useServerEvents } from "@/lib/sse";
import { useActionSheet } from "@/lib/action-sheet";
import { setForwardText } from "@/lib/forward";
import { onOpenThreadSearch } from "@/lib/thread-search";
import { openChatInfo } from "@/lib/chat-info";
import { openPersonPane } from "@/lib/person-pane";
import type { Message, Participant } from "@shared/types";
import { useMessages, type JumpTarget } from "@/hooks/use-messages";
import { usePrivateApi } from "@/hooks/use-health";
import { useTheme } from "@/hooks/use-theme";
import { useType } from "@/hooks/use-type";
import { CardShadow, Radii } from "@/constants/theme";
import { showToast } from "@/lib/toast";
import { patchChatWithMessage } from "@/lib/chat-store";
import type { ChatSummary } from "@shared/types";
import { useAiStatus } from "@/hooks/use-ai";
import { finishTriageChat, laterOptions, setTriageLater } from "@/hooks/use-triage-actions";
import { Bubble, TAPBACK_EMOJI } from "./bubble";
import { ChatAvatar, GroupAvatarStack } from "./avatar";
import { Composer } from "./composer";
import { CenteredSpinner } from "./empty-state";
import { SuggestionShelf } from "./suggestion-shelf";
import { FaceTimeButton } from "./facetime-button";

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const UNSEND_WINDOW_MS = 2 * 60 * 1000;
const GROUP_GAP_MS = 10 * 60 * 1000;

function formatWindowRemaining(windowMs: number, ageMs: number): string {
  const minutes = Math.max(1, Math.ceil((windowMs - ageMs) / 60_000));
  return `${minutes} min left`;
}

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
  /**
   * No longer read. It existed only as KeyboardAvoidingView's
   * keyboardVerticalOffset, and the keyboard lift is now driven directly from
   * Keyboard events (see bottomInset below). Kept so existing callers keep
   * compiling; safe to drop when they're next touched.
   */
  headerOffset?: number;
  /** When set (wide split-pane), render an in-pane header for this chat. */
  headerChat?: ChatSummary | null;
  /** Glide-mode preview: render without marking the conversation read. */
  previewOnly?: boolean;
  /** When provided (desktop split-pane with AI shadow available), show the toggle. */
  onToggleShadow?: () => void;
  shadowOpen?: boolean;
  /** Sweep mode advances only after a real send settles successfully. */
  onMessageSent?: () => void;
}

export function ThreadView({
  chatGuid,
  isGroup,
  jumpTarget = null,
  headerChat = null,
  previewOnly = false,
  onToggleShadow,
  shadowOpen = false,
  onMessageSent,
}: ThreadViewProps) {
  const theme = useTheme();
  const type = useType();
  const privateApi = usePrivateApi();
  const aiStatus = useAiStatus();
  const showSheet = useActionSheet();
  const messagesRef = useRef<Message[]>([]);
  const { messages, loading, hasMore, hasNewer, loadOlder, loadNewer, upsert, replaceTemp, reconcile } =
    useMessages(chatGuid, jumpTarget);
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
  const [participants, setParticipants] = useState<Participant[]>(headerChat?.participants ?? []);
  const dayChipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollingRef = useRef(false);
  const scrollingEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // FlatList requires stable identities for viewability callbacks.
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10 }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: unknown }> }) => {
      if (!scrollingRef.current) return;
      const top = viewableItems[viewableItems.length - 1];
      const row = top?.item as Row | undefined;
      if (!row) return;
      setDayChip(formatDayDivider(row.message.dateCreated));
      if (dayChipTimer.current) clearTimeout(dayChipTimer.current);
      dayChipTimer.current = setTimeout(() => setDayChip(null), 1200);
    },
  ).current;
  const beginDayChipScroll = useCallback((): void => {
    scrollingRef.current = true;
    if (scrollingEndTimer.current) clearTimeout(scrollingEndTimer.current);
  }, []);
  const endDayChipScroll = useCallback((): void => {
    if (scrollingEndTimer.current) clearTimeout(scrollingEndTimer.current);
    scrollingEndTimer.current = setTimeout(() => { scrollingRef.current = false; }, 180);
  }, []);
  const typingClear = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<Row>>(null);
  /** Guids whose entrance already played as a temp bubble; see onSettled. */
  const settledGuids = useRef(new Set<string>());

  /**
   * Follow an outbound message down to the newest row. maintainVisibleContentPosition
   * holds the current view when a row is inserted at index 0, which is right for
   * inbound backfill and wrong for something you just sent — without this the
   * thread stays parked where it was. Offset 0 is the newest end of an inverted list.
   */
  const scrollToLatest = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
  }, []);

  useEffect(() => {
    setReplyTo(null);
    setEditing(null);
    setSearchOpen(false);
    setSearchText("");
    settledGuids.current.clear();
    // Preview (glide-mode j/k) must not mark read; activation ("reply") does.
    if (!previewOnly) void api.markRead(chatGuid);
  }, [chatGuid, previewOnly]);

  useEffect(() => {
    if (headerChat) {
      setParticipants(headerChat.participants);
      return;
    }
    let cancelled = false;
    api
      .chatInfo(chatGuid)
      .then((info) => {
        if (!cancelled) setParticipants(info.participants);
      })
      .catch(() => {
        if (!cancelled) setParticipants([]);
      });
    return () => {
      cancelled = true;
    };
  }, [chatGuid, headerChat]);

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
      beginDayChipScroll();
      event.preventDefault();
      event.stopPropagation();
      node.scrollTop -= event.deltaY;
      endDayChipScroll();
    };
    node.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => node.removeEventListener("wheel", onWheel, { capture: true });
  }, [beginDayChipScroll, endDayChipScroll, listMounted]);

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
        } else if (event.kind === "resync") {
          // The event stream had a gap — anything sent or received meanwhile
          // never arrived as an event. Pull the thread current again.
          reconcile();
          if (!previewOnly) void api.markRead(chatGuid);
        }
      },
      [chatGuid, upsert, reconcile, previewOnly],
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
        .then((message) => {
          settledGuids.current.add(message.guid); // same key swap as onSettled
          replaceTemp(revived.guid, message);
        })
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
                hapticSelect();
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
          ? [{ label: `Edit · ${formatWindowRemaining(EDIT_WINDOW_MS, age)}`, onPress: () => setEditing(message) }]
          : []),
        ...(mine && privateApi && age < UNSEND_WINDOW_MS && !message.pending
          ? [
              {
                label: `Unsend · ${formatWindowRemaining(UNSEND_WINDOW_MS, age)}`,
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

  // The thread's bottom inset, driven by the keyboard rather than by
  // KeyboardAvoidingView — which silently applies NO padding on this
  // RN/Fabric build, leaving the composer rendered UNDERNEATH the keyboard
  // (verified in the simulator: setting keyboardVerticalOffset to 0 changed
  // nothing, so it was never the offset value). The keyboard events below do
  // fire; the composer already relies on them for its own spacing.
  //
  // With the keyboard closed the inset is the safe area instead, so the
  // composer stops running off the screen into the home indicator and the
  // display's rounded corners. One value covers both states: whichever is
  // taller. The keyboard's reported height already includes the safe-area
  // region, hence max() rather than a sum.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const change = Keyboard.addListener("keyboardWillChangeFrame", (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboardHeight(0));
    return () => {
      change.remove();
      hide.remove();
    };
  }, []);
  // Keyboard height ONLY. The safe-area strip belongs to the composer, whose
  // background fills it — lifting the whole thread by the inset instead left a
  // dead gap under the bar.
  const bottomInset = Platform.OS === "web" ? 0 : keyboardHeight;

  return (
    <View
      onLayout={(e) => setPaneW(e.nativeEvent.layout.width)}
      style={{ flex: 1, backgroundColor: theme.background, paddingBottom: bottomInset }}
    >
      {headerChat && (
        <View
          style={[
            styles.paneHeader,
            { backgroundColor: theme.background, borderBottomColor: theme.divider },
          ]}
        >
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
              <ChatAvatar chat={headerChat} size={30} />
            )}
            <View style={styles.paneIdentityText}>
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: type.title, fontWeight: "600" }}>
                {headerChat.displayName}
              </Text>
              <Text style={{ color: theme.textSecondary, fontSize: 11 }}>
                {headerChat.isGroup
                  ? `${headerChat.participants.length} people ›`
                  : `${headerChat.flags.unresponded ? "needs reply" : headerChat.flags.waiting ? "waiting" : "conversation"}${headerChat.unreadCount ? ` · ${headerChat.unreadCount} unread` : ""}`}
              </Text>
            </View>
          </Pressable>
          <View style={styles.paneHeaderActions}>
            {(headerChat.flags.unresponded || headerChat.flags.waiting) && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Mark conversation done"
                onPress={() => finishTriageChat(headerChat)}
                style={[styles.doneButton, { backgroundColor: theme.accent }]}
              >
                <Ionicons name="checkmark" size={16} color={theme.onAccent} />
                <Text style={[styles.doneButtonText, { color: theme.onAccent }]}>Done</Text>
              </Pressable>
            )}
            <FaceTimeButton
              chatGuid={chatGuid}
              isGroup={isGroup}
              address={isGroup ? null : (participants[0]?.address ?? null)}
              color={theme.textSecondary}
              compact
              onSent={(message) => {
                upsert(message);
                patchChatWithMessage(chatGuid, message);
              }}
            />
            <Pressable onPress={() => setSearchOpen(true)} hitSlop={8} style={styles.headerIconButton}>
              <Ionicons name="search" size={21} color={theme.textSecondary} />
            </Pressable>
            {onToggleShadow && (
              <Pressable onPress={onToggleShadow} hitSlop={8} style={styles.headerIconButton}>
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
              style={styles.headerIconButton}
            >
              <Ionicons name="information-circle-outline" size={24} color={theme.textSecondary} />
            </Pressable>
          </View>
        </View>
      )}
      {headerChat && (headerChat.flags.unresponded || headerChat.flags.waiting) && (
        <View testID="resolve-strip" style={[styles.resolveStrip, { backgroundColor: "rgba(0,122,255,0.06)", borderBottomColor: "rgba(0,122,255,0.15)" }]}>
          <Ionicons name="flag" size={16} color={theme.accent} />
          <Text numberOfLines={1} style={[styles.resolveCopy, { color: theme.text }]}>In your queue — replying clears it automatically.</Text>
          <Pressable onPress={() => { void finishTriageChat(headerChat); }} style={[styles.resolveAction, { backgroundColor: theme.background }]}><Ionicons name="checkmark" size={13} color={theme.text} /><Text style={[styles.resolveActionText, { color: theme.text }]}>Done <Text style={{ color: theme.textSecondary }}>E</Text></Text></Pressable>
          <Pressable onPress={() => showSheet({ title: `Later · ${headerChat.displayName}`, actions: laterOptions().map((option) => ({ label: option.label, onPress: () => { void setTriageLater(headerChat, option.until); } })) })} style={[styles.resolveAction, { backgroundColor: theme.background }]}><Ionicons name="time-outline" size={13} color={theme.text} /><Text style={[styles.resolveActionText, { color: theme.text }]}>Later <Text style={{ color: theme.textSecondary }}>H</Text></Text></Pressable>
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
        <CenteredSpinner />
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
          onStartReached={() => {
            // Index 0 is where an inverted list rests, so an unguarded call here
            // refetches on open, on every settle at the bottom, and after each send.
            if (hasNewer && !loading) loadNewer();
          }}
          onStartReachedThreshold={0.2}
          // Without persistTaps the first tap on a bubble is eaten dismissing the
          // keyboard. Dismissal stays "on-drag", NOT "interactive": interactive
          // moves the keyboard continuously, while bottomInset above only updates
          // on keyboardWillChangeFrame/WillHide, so it desyncs mid-gesture and
          // strands the composer above a gap. Interactive needs the composer on
          // react-native-keyboard-controller first.
          keyboardDismissMode={Platform.OS === "web" ? "none" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
          }}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onScrollBeginDrag={beginDayChipScroll}
          onMomentumScrollBegin={beginDayChipScroll}
          onScrollEndDrag={endDayChipScroll}
          onMomentumScrollEnd={endDayChipScroll}
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
          renderItem={({ item, index }) => {
            const olderMessage = rows[index + 1]?.message ?? null;
            const unreadBoundary =
              firstUnreadAt !== null &&
              !item.message.isFromMe &&
              item.message.dateCreated >= firstUnreadAt &&
              (olderMessage === null || olderMessage.dateCreated < firstUnreadAt);
            return (
              <Reanimated.View
                entering={
                  // FadeInUp, not Down: the list is inverted, so each cell carries
                  // scaleY:-1 and a downward animation renders as an upward one.
                  Date.now() - item.message.dateCreated < 4000 &&
                  !settledGuids.current.has(item.message.guid)
                    ? FadeInUp.springify().damping(22)
                    : undefined
                }
              >
                {unreadBoundary && (
                  <View style={styles.unreadDivider}>
                    <View style={[styles.unreadLine, { backgroundColor: theme.accent }]} />
                    <Text style={[styles.unreadLabel, { color: theme.accent }]}>
                      {headerChat?.unreadCount ?? 1} unread
                    </Text>
                    <View style={[styles.unreadLine, { backgroundColor: theme.accent }]} />
                  </View>
                )}
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
            );
          }}
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
        isGroup={isGroup}
        participants={participants}
        privateApi={privateApi}
        replyTo={replyTo}
        editing={editing}
        onClearReply={() => setReplyTo(null)}
        onClearEditing={() => setEditing(null)}
        onEdited={upsert}
        onOptimistic={(message) => {
          upsert(message);
          patchChatWithMessage(chatGuid, message);
          scrollToLatest();
        }}
        onSettled={(tempGuid, message) => {
          // The settled message carries a new guid, so the row remounts under a
          // new key — suppress its entrance so the bubble doesn't spring twice.
          settledGuids.current.add(message.guid);
          replaceTemp(tempGuid, message);
          if (!message.failed) patchChatWithMessage(chatGuid, message);
        }}
        onSent={(message) => {
          upsert(message);
          patchChatWithMessage(chatGuid, message);
          scrollToLatest();
          onMessageSent?.();
        }}
      />
    </View>
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
    alignItems: "center",
    borderBottomWidth: 0.5,
    flexDirection: "row",
    height: 52,
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  paneHeaderActions: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 4,
  },
  doneButton: {
    alignItems: "center",
    borderRadius: 7,
    flexDirection: "row",
    gap: 4,
    height: 28,
    paddingHorizontal: 10,
  },
  doneButtonText: {
    fontSize: 12,
    fontWeight: "700",
  },
  headerIconButton: {
    alignItems: "center",
    borderRadius: 7,
    height: 28,
    justifyContent: "center",
    width: 32,
  },
  resolveStrip: {
    alignItems: "center",
    borderBottomWidth: 0.5,
    flexDirection: "row",
    gap: 8,
    minHeight: 41,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  resolveCopy: {
    flex: 1,
    fontSize: 12,
  },
  resolveAction: {
    alignItems: "center",
    borderRadius: 7,
    flexDirection: "row",
    gap: 4,
    height: 24,
    paddingHorizontal: 8,
  },
  resolveActionText: {
    fontSize: 11,
    fontWeight: "600",
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
    borderRadius: Radii.chip,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
  },
  paneIdentity: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minWidth: 0,
    paddingRight: 12,
  },
  paneIdentityText: {
    flex: 1,
    minWidth: 0,
  },
  dayChipWrap: {
    position: "absolute",
    top: 10,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  dayChipWrapWithHeader: {
    top: 101,
  },
  // The in-thread search shelf sits above the scroll — push the chip below it.
  dayChipWrapWithSearch: {
    top: 120,
  },
  dayChip: {
    borderRadius: Radii.card,
    paddingHorizontal: 12,
    paddingVertical: 5,
    ...CardShadow,
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
  unreadDivider: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginHorizontal: 18,
    marginVertical: 8,
  },
  unreadLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  unreadLabel: {
    fontSize: 10,
    fontWeight: "600",
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
