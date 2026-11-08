import { runCommand } from "@/lib/convex-commands";
import { messagingCommandError } from "@/lib/messaging-api";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Reanimated, { FadeInUp } from "react-native-reanimated";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { api } from "@/lib/api";
import { formatDayDivider, formatThreadTime, sameDay } from "@/lib/format";
import { hapticSelect } from "@/lib/haptics";
import { usePeerTyping } from "@/lib/presence-api";
import { createInboundReadObserver } from "@/lib/message-observers";
import { useActionSheet } from "@/lib/action-sheet";
import { copyHandleAction } from "@/lib/copy-handle";
import { setForwardText } from "@/lib/forward";
import { pendingSends, SendCancelledError } from "@/lib/pending-sends";
import { onOpenThreadSearch } from "@/lib/thread-search";
import { readChat } from "@/lib/chat-actions";
import { useAgentEnabled } from "@/hooks/use-agent";
import { useConversation } from "@/hooks/use-chat-directory";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";
import { openAgentPane } from "@/lib/agent-pane";
import { openChatInfo } from "@/lib/chat-info";
import { openPersonPane } from "@/lib/person-pane";
import { conversationRoute, hasSendError } from "@shared/imessage";
import { keyEmoji, PROFILES } from "@shared/platform-profile";
import type { Message, Participant } from "@shared/types";
import { useMessages, type JumpTarget } from "@/hooks/use-messages";
import { useTheme } from "@/hooks/use-theme";
import { useType } from "@/hooks/use-type";
import { CardShadow, HOVER_DIM, Radii } from "@/constants/theme";
import { showToast, ToastAnchor } from "@/lib/toast";
import type { ChatSummary, ConversationId } from "@shared/types";
import { useAiStatus } from "@/hooks/use-ai";
import { Bubble } from "./bubble";
import { reactionGlyph, TAPBACK_LABEL } from "@/lib/tapbacks";
import { sinceYourReply } from "./message-meta";
import { Composer } from "./composer";
import { QueuePosition } from "./queue-position";
import { StateStrip } from "./state-strip";
import { ErrorState } from "./empty-state";
import { BlurSwap } from "./motion/blur-swap";
import { ThreadSkeleton } from "./thread-skeleton";
import { FaceTimeButton } from "./facetime-button";
import { IconButton } from "./ui/icon-button";
import AiChat02Icon from "@hugeicons/core-free-icons/AiChat02Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import SidebarRightIcon from "@hugeicons/core-free-icons/SidebarRightIcon";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { TriageGeometry } from "@/constants/triage-theme";
import { toolbarTitle } from "@/lib/header-font";
import { TypingIndicator } from "./typing-indicator";
import { useRouteSupport } from "@/hooks/use-route-support";
import { gated, reasonOf } from "@/lib/route-support";

const GROUP_GAP_MS = 10 * 60 * 1000;
const COLUMN_PAD = 32;
const PHONE_PAD = 12;

function formatWindowRemaining(windowMs: number, ageMs: number): string | undefined {
  if (!Number.isFinite(windowMs)) return undefined;
  const minutes = Math.max(1, Math.ceil((windowMs - ageMs) / 60_000));
  return `${minutes} min left`;
}

interface Row {
  message: Message;
  groupStart: boolean;
  groupEnd: boolean;
  newDay: boolean;
  /** Inside the inbound run since your last reply; the run's first row carries its size. */
  since: { count: number | null } | null;
  /** The oldest unread message, which draws the unread divider above it. */
  unreadBoundary: boolean;
}

const rowKey = (row: Row): string => row.message.clientKey ?? row.message.guid;

/** Same values, field by field. Nested arrays and objects compare by content. */
function sameMessage(a: Message, b: Message): boolean {
  if (a === b) return true;
  const keys = Object.keys(a) as Array<keyof Message>;
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key] ||
    (typeof a[key] === "object" && a[key] !== null && JSON.stringify(a[key]) === JSON.stringify(b[key])));
}

/** `next` with `previous`'s identity when nothing a row draws changed, so its memoized cell skips the render. */
function keepRow(previous: Row | undefined, next: Row): Row {
  if (!previous || !sameMessage(previous.message, next.message)) return next;
  const same = previous.groupStart === next.groupStart && previous.groupEnd === next.groupEnd &&
    previous.newDay === next.newDay && previous.unreadBoundary === next.unreadBoundary &&
    (previous.since === null) === (next.since === null) && previous.since?.count === next.since?.count;
  return same ? previous : { ...next, message: previous.message };
}

interface ThreadViewProps {
  conversationId: ConversationId;
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
  /** The lens the chat was opened from: the muted first crumb of the header. */
  lensLabel?: string;
  /** Glide-mode preview: render without marking the conversation read. */
  previewOnly?: boolean;
  /** Auto-advance: the name this conversation replaced, which the breadcrumb blur-swaps out. */
  advancedFrom?: string;
  toastActive?: boolean;
}

export function ThreadView({
  conversationId,
  isGroup,
  jumpTarget = null,
  headerChat = null,
  lensLabel,
  previewOnly = false,
  advancedFrom,
  toastActive = true,
}: ThreadViewProps) {
  const theme = useTheme();
  const type = useType();
  const aiStatus = useAiStatus();
  const agentEnabled = useAgentEnabled();
  const showSheet = useActionSheet();
  const paneRef = useRef<View>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const messagesRef = useRef<Message[]>([]);
  const conversation = useConversation(conversationId);
  // Read at tap time, so a new last message does not hand every row a new long-press handler.
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const can = useRouteSupport(conversation);
  const { messages, loading, failed, retry: retryLoad, hasMore, hasNewer, loadOlder, loadNewer, upsert, replaceTemp, remove, pend, newestMessages } =
    useMessages(conversationId, jumpTarget);
  messagesRef.current = messages;
  // It is your turn when the newest real message is inbound. Drives whether
  // the suggestion shelf appears at all.
  const awaitingReply = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m || m.isGroupEvent) continue;
      return !m.isFromMe;
    }
    return false;
  }, [messages]);
  const reactionPreview = useCallback((messageGuid: string): string => {
    const message = messagesRef.current.find((item) => item.guid === messageGuid);
    const preview = message?.text.trim() || "this message";
    return preview.length > 72 ? `${preview.slice(0, 69)}…` : preview;
  }, []);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [highlightGuid, setHighlightGuid] = useState<string | null>(null);
  const peerTyping = usePeerTyping(conversationId);
  const readObserver = useRef(createInboundReadObserver());
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
  const listRef = useRef<FlatList<Row>>(null);

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
    // Preview (glide-mode j/k) must not mark read; activation ("reply") does.
    if (!previewOnly) readChat(conversationId).catch(() => undefined);
  }, [conversationId, previewOnly]);

  useEffect(() => {
    if (headerChat) {
      setParticipants(headerChat.participants);
      return;
    }
    let cancelled = false;
    api
      .chatInfo(conversationId)
      .then((info) => {
        if (!cancelled) setParticipants(info.participants);
      })
      .catch(() => {
        if (!cancelled) setParticipants([]);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, headerChat]);

  // Header search buttons open the in-thread search shelf via a signal bus.
  useEffect(() => onOpenThreadSearch(() => setSearchOpen(true)), []);


  // Web: RNW's inverted-list wheel handling is broken (reversed / inert), so
  // drive the scroll ourselves. Inverted container ⇒ wheel-up must increase
  // scrollTop (toward older messages).
  const [paneW, setPaneW] = useState(0);
  // The reading column the bubbles size against: 760 max on desk, the pane less its gutters on phone.
  const columnW = headerChat
    ? Math.max(0, Math.min(TriageGeometry.threadMaxWidth, paneW - 2 * COLUMN_PAD))
    : Math.max(0, paneW - 2 * PHONE_PAD);
  const onPaneLayout = useCallback((width: number): void => {
    const next = Math.round(width);
    setPaneW((current) => (current === next ? current : next));
  }, []);
  // Stable: an inline ref that setStates is React 19 #185 (nested updates
  // during commit attach). Wheel binding waits for layout, when the node exists.
  const assignListRef = useCallback((node: FlatList<Row> | null): void => {
    (listRef as React.MutableRefObject<FlatList<Row> | null>).current = node;
  }, []);
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
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
  }, [beginDayChipScroll, conversationId, endDayChipScroll, messages.length]);

  useEffect(() => {
    if (readObserver.current.observe(conversationId, [...messages, ...newestMessages], !previewOnly)) {
      readChat(conversationId).catch(() => undefined);
    }
  }, [conversationId, messages, newestMessages, previewOnly]);

  const firstUnreadAt = headerChat?.firstUnreadAt ?? null;
  const previousRows = useRef(new Map<string, Row>());
  const rows = useMemo<Row[]>(() => {
    const visible = messages.filter((m) => !m.isGroupEvent || m.text);
    const run = sinceYourReply(visible);
    const previous = previousRows.current;
    const built = visible.map((message, index): Row => {
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
      const since = index < run.start ? null : { count: index === run.start ? run.count : null };
      const unreadBoundary = firstUnreadAt !== null && !message.isFromMe && message.dateCreated >= firstUnreadAt &&
        (prev === undefined || prev.dateCreated < firstUnreadAt);
      const row = { message, groupStart: !samePrev, groupEnd: !sameNext, newDay, since, unreadBoundary };
      return keepRow(previous.get(rowKey(row)), row);
    });
    previousRows.current = new Map(built.map((row) => [rowKey(row), row]));
    return built.reverse(); // inverted list renders newest first
  }, [messages, firstUnreadAt]);

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
    () => rows.find((r) => r.message.isFromMe && r.message.sendState !== "failed" && r.message.sendState !== "notSent")?.message.guid ?? null,
    [rows],
  );
  const latestInboundAt = useMemo(
    () => rows.find((r) => !r.message.isFromMe)?.message.dateCreated ?? null,
    [rows],
  );

  const retry = useCallback(
    (stranded: Message) => {
      pendingSends.retry(conversationId, stranded).catch((error: unknown) => {
        if (!(error instanceof SendCancelledError)) showToast(messagingCommandError(error, "Send failed"));
      });
    },
    [conversationId],
  );

  const cancelSend = useCallback(
    (queued: Message) => {
      pendingSends.cancel(conversationId, queued)
        .then((cancelled) => { if (!cancelled) showToast("Already sending"); })
        .catch((error: unknown) => showToast(messagingCommandError(error, "Couldn't cancel")));
    },
    [conversationId],
  );

  const showReactions = useCallback(
    (message: Message) => {
      showSheet({
        title: "Reactions",
        actions: message.reactions.map((r) => ({
          label: `${reactionGlyph(r)}  ${r.isFromMe ? "You" : (r.senderName ?? r.senderAddress ?? "Unknown")}`,
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
      const react = can("react");
      const sendReaction = (key: string, remove: boolean) => {
        const rollback = pend(message.guid, { kind: "react", key, remove });
        hapticSelect();
        runCommand(conversationId, { kind: "react", messageGuid: message.guid, reaction: key, remove }).catch(() => {
          rollback();
          showToast("Couldn't send the reaction. Try again.");
        });
      };
      const isMine = (key: string) => message.reactions.some((r) => r.isFromMe && r.key === key);
      // The tray offers the route's reaction set from its platform profile, then my other emoji reactions so they can be removed.
      const opened = conversationRef.current;
      const named = react && opened ? PROFILES[conversationRoute(opened).platform].reactions : undefined;
      const myEmoji = named ? message.reactions.filter((r) => r.isFromMe && keyEmoji(r.key) && !named.includes(r.key)).map((r) => r.key) : [];
      const tapbacks = named
        ? [...named, ...myEmoji].map((key) => {
            const active = isMine(key);
            return { key, label: TAPBACK_LABEL[key] ?? keyEmoji(key) ?? key, active, onPress: () => sendReaction(key, active) };
          })
        : undefined;
      const emojiReact = can("emojiReact");
      const emoji = named && emojiReact
        ? { unavailable: reasonOf(emojiReact), onPick: (value: string) => sendReaction(`emoji:${value}`, isMine(`emoji:${value}`)) }
        : undefined;
      const edit = can("edit");
      const unsend = can("unsend");
      const { editWindowMs, unsendWindowMs, unsendLabel } = PROFILES[message.platform];
      const actions = [
        ...gated(can("reply"), { label: "Reply", onPress: () => setReplyTo(message) }),
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
        ...(isGroup && !mine && message.sender?.address
          ? [copyHandleAction(message.sender.address, message.sender.name?.split(" ")[0])]
          : []),
        // A persisted error code is often stale, so this sends a new copy instead of an in-bubble retry.
        ...(mine && message.text && hasSendError(message) && !message.sendState
          ? [
              {
                label: "Send again",
                onPress: () => {
                  const chat = conversationRef.current;
                  if (!chat) return;
                  const replyTo = message.replyToGuid ? { guid: message.replyToGuid, text: message.replyToPreview ?? "", isFromMe: message.replyToFromMe ?? false } : null;
                  pendingSends.send(chat, { text: message.text, replyTo, mentions: message.mentions }).catch((error: unknown) => {
                    if (!(error instanceof SendCancelledError)) showToast(messagingCommandError(error, "Send failed"));
                  });
                  scrollToLatest();
                },
              },
            ]
          : []),
        // While a send is confirming, show Edit and Undo send inert rather than hiding them.
        ...(mine && message.text && message.sendState
          ? [...gated(edit, { label: "Edit", disabled: true, separatorBefore: true, onPress: () => undefined }),
            ...gated(unsend, { label: unsendLabel, disabled: true, note: "Available once it's sent", onPress: () => undefined })]
          : []),
        ...(mine && message.text && age < editWindowMs && !message.sendState
          ? gated(edit, { label: "Edit", note: formatWindowRemaining(editWindowMs, age), separatorBefore: true, onPress: () => setEditing(message) })
          : []),
        ...(mine && age < unsendWindowMs && !message.sendState
          ? gated(unsend, {
                label: unsendLabel,
                note: formatWindowRemaining(unsendWindowMs, age),
                // Edit is hidden past its window or on a text-less message, so this opens the block.
                separatorBefore: !(message.text && age < editWindowMs),
                destructive: true,
                onPress: () => {
                  const rollback = pend(message.guid, { kind: "retract" });
                  runCommand(conversationId, { kind: "unsend", messageGuid: message.guid }).catch(() => {
                    rollback();
                    showToast(Number.isFinite(unsendWindowMs) ? "Couldn't unsend. Messages can only be unsent for about 2 minutes." : "Couldn't delete the message. Try again.");
                  });
                },
              })
          : []),
        // "Remove for you" — deletes locally (Mac's Messages DB), any age,
        // either side. The tool for clearing failed/Not Delivered sends.
        ...(!message.sendState
          ? gated(can("deleteMessage"), {
                label: "Delete for Me",
                separatorBefore: true,
                destructive: true,
                onPress: () => {
                  const rollback = pend(message.guid, { kind: "retract" });
                  runCommand(conversationId, { kind: "delete", messageGuid: message.guid }).then(() => showToast("Deleted"), () => {
                    rollback();
                    showToast("Couldn't delete the message. Try again.");
                  });
                },
              })
          : []),
      ];
      if (actions.length > 0 || tapbacks) showSheet({ actions, tapbacks, emoji, tapbacksUnavailable: reasonOf(react), anchor });
    },
    [can, conversationId, isGroup, pend, scrollToLatest, showSheet],
  );

  const desk = headerChat !== null;
  const unreadCount = headerChat?.unreadCount ?? 1;
  const renderItem = useCallback(({ item }: { item: Row }) => (
    <ThreadRow
      row={item}
      desk={desk}
      columnW={columnW}
      conversationId={conversationId}
      isGroup={isGroup}
      isLatestOutgoing={item.message.guid === latestOutgoingGuid}
      // Only an outgoing message with an error code reads it, so an arrival leaves every other row alone.
      latestInboundAt={item.message.isFromMe && hasSendError(item.message) ? latestInboundAt : null}
      highlighted={item.message.guid === highlightGuid}
      unreadCount={item.unreadBoundary ? unreadCount : 0}
      onLongPress={openMessageSheet}
      onRetry={retry}
      onCancel={cancelSend}
      onShowReactions={showReactions}
    />
  ), [cancelSend, columnW, conversationId, desk, highlightGuid, isGroup, latestInboundAt, latestOutgoingGuid, openMessageSheet, retry, showReactions, unreadCount]);

  // Keyboard height only. The safe-area strip belongs to the composer, whose
  // background fills it; lifting the whole thread by the inset left a dead gap under the bar.
  const bottomInset = useKeyboardHeight();

  return (
    <View
      ref={paneRef}
      testID="thread-view"
      onLayout={(e) => onPaneLayout(e.nativeEvent.layout.width)}
      style={{ flex: 1, backgroundColor: headerChat ? theme.thread : theme.background, paddingBottom: bottomInset }}
    >
      {headerChat && (
        <View style={[styles.paneHeader, { borderBottomColor: theme.divider }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={headerChat.isGroup ? `Group details for ${headerChat.displayName}` : `Contact details for ${headerChat.displayName}`}
            style={styles.paneIdentity}
            onPress={() => {
              if (headerChat.isGroup) {
                openChatInfo(conversationId);
              } else {
                const p = headerChat.participants[0];
                if (p) openPersonPane({ address: p.address, name: headerChat.displayName, backConversation: conversationId });
              }
            }}
          >
            {lensLabel ? (
              <>
                <Text numberOfLines={1} style={[styles.crumb, { color: theme.textSecondary }]}>{lensLabel}</Text>
                <Text aria-hidden style={[styles.crumbSlash, { color: theme.textTertiary }]}>/</Text>
              </>
            ) : null}
            <ThreadTitle name={headerChat.displayName} from={advancedFrom} color={theme.text} />
            {headerChat.isGroup && headerChat.participants.length > 0 && (
              <Text numberOfLines={1} style={[styles.peopleCount, { color: theme.textTertiary }]}>
                {headerChat.participants.length + 1} people
              </Text>
            )}
          </Pressable>
          <View style={styles.paneHeaderActions}>
            <QueuePosition />
            <View style={[styles.vsep, { backgroundColor: theme.divider }]} />
            <FaceTimeButton
              conversationId={conversationId}
              isGroup={isGroup}
              address={isGroup ? null : (participants[0]?.address ?? null)}
              color={theme.icon}
              compact
              onSent={(message) => {
                upsert(message);
              }}
            />
            <IconButton label="Search conversation" onPress={() => setSearchOpen(true)} style={styles.headerIconButton}>
              {({ active }) => <HugeiconsIcon icon={Search01Icon} size={18} color={active ? theme.text : theme.icon} strokeWidth={1.6} />}
            </IconButton>
            {agentEnabled ? (
              <IconButton label="Ask the agent (⌘J)" onPress={() => openAgentPane(conversationId)} style={styles.headerIconButton}>
                {({ active }) => <HugeiconsIcon icon={AiChat02Icon} size={18} color={active ? theme.text : theme.icon} strokeWidth={1.6} />}
              </IconButton>
            ) : null}
            <IconButton label="Conversation info" onPress={() => openChatInfo(conversationId)} style={styles.headerIconButton}>
              {({ active }) => <HugeiconsIcon icon={SidebarRightIcon} size={18} color={active ? theme.text : theme.icon} strokeWidth={1.6} />}
            </IconButton>
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
            accessibilityRole="button"
            accessibilityLabel="Previous match"
            disabled={searchMatches.length === 0}
            onPress={() => setMatchIndex((i) => (i + 1) % searchMatches.length)}
            hitSlop={6}
            style={({ hovered, pressed }) => [styles.searchShelfAction, (hovered || pressed) && { backgroundColor: theme.backgroundSelected }, pressed && { opacity: HOVER_DIM }]}
          >
            {({ hovered, pressed }) => <Ionicons name="chevron-up" size={22} color={searchMatches.length ? hovered || pressed ? theme.text : theme.accent : theme.textSecondary} />}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next match"
            disabled={searchMatches.length === 0}
            onPress={() => setMatchIndex((i) => (i - 1 + searchMatches.length) % searchMatches.length)}
            hitSlop={6}
            style={({ hovered, pressed }) => [styles.searchShelfAction, (hovered || pressed) && { backgroundColor: theme.backgroundSelected }, pressed && { opacity: HOVER_DIM }]}
          >
            {({ hovered, pressed }) => <Ionicons name="chevron-down" size={22} color={searchMatches.length ? hovered || pressed ? theme.text : theme.accent : theme.textSecondary} />}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close search"
            onPress={() => {
              setSearchOpen(false);
              setSearchText("");
              setHighlightGuid(null);
            }}
            hitSlop={6}
            style={({ hovered, pressed }) => [styles.searchShelfAction, (hovered || pressed) && { backgroundColor: theme.backgroundSelected }, pressed && { opacity: HOVER_DIM }]}
          >
            {({ hovered, pressed }) => <Text style={{ color: hovered || pressed ? theme.text : theme.accent, fontSize: 15 }}>Done</Text>}
          </Pressable>
        </View>
      )}

      {loading && messages.length === 0 ? (
        <ThreadSkeleton />
      ) : failed && messages.length === 0 ? (
        <ErrorState
          title="Unable to load this conversation"
          message="The Mac mini didn't answer. Check that it's awake, then try again."
          onRetry={retryLoad}
        />
      ) : (
        <FlatList
          testID="thread-message-list"
          ref={assignListRef}
          data={rows}
          inverted
          // A sent message keeps its optimistic row's key, so settling never remounts it.
          keyExtractor={(row) => row.message.clientKey ?? row.message.guid}
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
          contentContainerStyle={headerChat
            ? { paddingVertical: 16, paddingHorizontal: Math.max(COLUMN_PAD, (paneW - TriageGeometry.threadMaxWidth) / 2) }
            : { paddingVertical: 10, paddingHorizontal: PHONE_PAD }}
          ListHeaderComponent={
            peerTyping ? (
              <View style={styles.typingRow}>
                <TypingIndicator />
              </View>
            ) : null
          }
          renderItem={renderItem}
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
      <ToastAnchor active={toastActive}>
        {conversation ? <Composer
          suggestions={{
            enabled: aiStatus?.suggestions === true && !editing,
            awaitingReply,
            reactionSuggestions: can("react")?.ok === true,
            reactionUnavailable: reasonOf(can("react")),
            reactionPreview,
          }}
          strip={<StateStrip conversationId={conversationId} messages={messages} historyComplete={!hasMore} />}
          chat={conversation}
          isGroup={isGroup}
          participants={participants}
          replyTo={replyTo}
          editing={editing}
          onClearReply={() => setReplyTo(null)}
          onClearEditing={() => setEditing(null)}
          onEdit={pend}
          onOptimistic={(message) => {
            upsert(message);
            scrollToLatest();
          }}
          onSettled={(tempGuid, message) => {
            replaceTemp(tempGuid, message);
          }}
          onSending={scrollToLatest}
          onWithdraw={remove}
          onSent={(message) => {
            upsert(message);
            scrollToLatest();
          }}
          dropTargetRef={paneRef}
          onDragActiveChange={setFileDragActive}
        /> : null}
      </ToastAnchor>
      {fileDragActive && (
        <View
          pointerEvents="none"
          style={[styles.dropOverlay, { borderColor: theme.accent, backgroundColor: theme.backdrop }]}
        >
          <View style={[styles.dropLabel, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="attach" size={18} color={theme.accent} />
            <Text style={{ color: theme.text, fontSize: type.title, fontWeight: "600" }}>
              Drop to attach
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

interface ThreadRowProps {
  row: Row;
  desk: boolean;
  columnW: number;
  conversationId: ConversationId;
  isGroup: boolean;
  isLatestOutgoing: boolean;
  latestInboundAt: number | null;
  highlighted: boolean;
  /** The unread divider's count; 0 on every row but the boundary. */
  unreadCount: number;
  onLongPress: (message: Message, anchor?: { x: number; y: number }) => void;
  onRetry: (message: Message) => void;
  onCancel: (message: Message) => void;
  onShowReactions: (message: Message) => void;
}

/** One message row. Memoized on its props, so a new page renders only the rows it adds. */
const ThreadRow = memo(function ThreadRow({
  row,
  desk,
  columnW,
  conversationId,
  isGroup,
  isLatestOutgoing,
  latestInboundAt,
  highlighted,
  unreadCount,
  onLongPress,
  onRetry,
  onCancel,
  onShowReactions,
}: ThreadRowProps) {
  const theme = useTheme();
  const { message } = row;
  const sinceStart = row.since?.count != null;
  const body = message.isGroupEvent ? (
    <Text style={[styles.groupEvent, { color: theme.textTertiary }]}>
      {message.text}
    </Text>
  ) : (
    <Bubble
      message={message}
      conversationId={conversationId}
      paneWidth={columnW}
      groupStart={row.groupStart}
      groupEnd={row.groupEnd}
      isGroupChat={isGroup}
      isLatestOutgoing={isLatestOutgoing}
      latestInboundAt={latestInboundAt}
      highlighted={highlighted}
      onLongPress={onLongPress}
      onRetry={onRetry}
      onCancel={onCancel}
      onShowReactions={onShowReactions}
    />
  );
  return (
    <Reanimated.View
      entering={
        // FadeInUp, not Down: the list is inverted, so each cell carries
        // scaleY:-1 and a downward animation renders as an upward one.
        Date.now() - message.dateCreated < 4000
          ? FadeInUp.springify().damping(22)
          : undefined
      }
    >
      {row.unreadBoundary && !sinceStart && (
        <View style={styles.unreadDivider}>
          <View style={[styles.unreadLine, { backgroundColor: theme.accent }]} />
          <Text style={[styles.unreadLabel, { color: theme.accent }]}>
            {unreadCount} unread
          </Text>
          <View style={[styles.unreadLine, { backgroundColor: theme.accent }]} />
        </View>
      )}
      {row.newDay && !sinceStart && (
        <Text style={[styles.dayDivider, !desk && styles.dayDividerPhone, { color: theme.textTertiary }]}>
          {formatThreadTime(message.dateCreated)}
        </Text>
      )}
      {row.since ? (
        <View
          style={[
            desk ? styles.sinceRunDesk : styles.sinceRunPhone,
            sinceStart && (desk ? styles.sinceStartDesk : styles.sinceStartPhone),
            { borderLeftColor: theme.turnMark },
          ]}
        >
          {sinceStart && (
            <View style={[styles.sinceLabel, desk ? styles.sinceLabelDesk : styles.sinceLabelPhone]}>
              <Text style={[styles.sinceCount, { color: theme.turn, fontSize: desk ? 11.5 : 13 }]}>
                {row.since.count} since your reply
              </Text>
              <Text style={{ color: theme.textTertiary, fontSize: desk ? 11.5 : 13 }}>
                {formatThreadTime(message.dateCreated)}
              </Text>
            </View>
          )}
          {body}
        </View>
      ) : body}
    </Reanimated.View>
  );
});

/** The breadcrumb name. After an auto-advance it mounts on the previous name, then blur-swaps to this one. */
function ThreadTitle({ name, from, color }: { name: string; from: string | undefined; color: string }) {
  const [shown, setShown] = useState(from ?? name);
  useEffect(() => setShown(name), [name]);
  return (
    <BlurSwap swapKey={shown} style={styles.titleSwap}>
      <Text role="heading" aria-level={2} numberOfLines={1} style={[styles.threadTitle, { color }]}>{shown}</Text>
    </BlurSwap>
  );
}

const styles = StyleSheet.create({
  paneHeader: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: TriageGeometry.threadHeaderHeight,
    justifyContent: "space-between",
    paddingLeft: 22,
    paddingRight: 12,
  },
  paneHeaderActions: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 4,
  },
  headerIconButton: { borderRadius: 7, height: 30, width: 30 },
  crumb: { flexShrink: 1, fontSize: 13.5 },
  crumbSlash: { fontSize: 14, marginHorizontal: 8 },
  peopleCount: { flexShrink: 0, fontSize: 12.5, marginLeft: 12 },
  titleSwap: { flexShrink: 1, minWidth: 0 },
  threadTitle: { ...toolbarTitle, flexShrink: 1 },
  vsep: { height: 16, marginHorizontal: 6, width: 1 },
  searchShelfAction: { alignItems: "center", borderRadius: 6, justifyContent: "center", minWidth: 22, paddingHorizontal: 5, paddingVertical: 3 },
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
    flexDirection: "row",
    flexShrink: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  dropOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    borderRadius: Radii.card,
    borderStyle: "dashed",
    borderWidth: 2,
    justifyContent: "center",
    margin: 8,
  },
  dropLabel: {
    alignItems: "center",
    borderRadius: Radii.input,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
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
    paddingVertical: 6,
    alignItems: "flex-start",
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
  sinceRunDesk: { borderLeftWidth: 2, marginLeft: -17, paddingLeft: 15 },
  sinceRunPhone: { borderLeftWidth: 2, marginLeft: -12, paddingLeft: 10 },
  sinceStartDesk: { marginTop: 22 },
  sinceStartPhone: { marginTop: 18 },
  sinceLabel: { flexDirection: "row" },
  sinceLabelDesk: { gap: 10, marginBottom: 3 },
  sinceLabelPhone: { gap: 8, marginBottom: 4 },
  sinceCount: { fontWeight: "600" },
  dayDivider: {
    textAlign: "center",
    fontSize: 11.5,
    marginBottom: 8,
    marginTop: 16,
  },
  dayDividerPhone: { fontSize: 12, marginBottom: 6, marginTop: 14 },
  groupEvent: {
    textAlign: "center",
    fontSize: 12,
    marginBottom: 6,
    marginTop: 12,
    paddingHorizontal: 20,
  },
});
