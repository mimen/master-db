import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { api } from "@/lib/api";
import { formatDayDivider, sameDay } from "@/lib/format";
import { useServerEvents } from "@/lib/sse";
import { useActionSheet } from "@/lib/action-sheet";
import type { Message } from "@/lib/types";
import { useMessages, type JumpTarget } from "@/hooks/use-messages";
import { usePrivateApi } from "@/hooks/use-health";
import { useTheme } from "@/hooks/use-theme";
import { Bubble, TAPBACK_EMOJI } from "./bubble";
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
}

export function ThreadView({ chatGuid, isGroup, jumpTarget = null, headerOffset = 0 }: ThreadViewProps) {
  const theme = useTheme();
  const privateApi = usePrivateApi();
  const showSheet = useActionSheet();
  const { messages, loading, hasMore, loadOlder, loadNewer, upsert, replaceTemp } = useMessages(
    chatGuid,
    jumpTarget,
  );
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const listRef = useRef<FlatList<Row>>(null);

  useEffect(() => {
    setReplyTo(null);
    setEditing(null);
    void api.markRead(chatGuid);
  }, [chatGuid]);


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
    }, 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget, rows]);

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

  const openMessageSheet = useCallback(
    (message: Message) => {
      const mine = message.isFromMe;
      const age = Date.now() - message.dateCreated;
      const actions = [
        ...(privateApi
          ? [
              {
                label: "React…",
                onPress: () => {
                  showSheet({
                    actions: [...TAPBACK_EMOJI.entries()].map(([type, emoji]) => {
                      const active = message.reactions.some((r) => r.isFromMe && r.type === type);
                      return {
                        label: `${emoji}${active ? " ✓" : ""}`,
                        onPress: () => {
                          void api.react(message.guid, {
                            chatGuid,
                            reaction: type,
                            remove: active,
                          });
                        },
                      };
                    }),
                  });
                },
              },
              { label: "Reply", onPress: () => setReplyTo(message) },
            ]
          : []),
        ...(message.text
          ? [{ label: "Copy", onPress: () => void Clipboard.setStringAsync(message.text) }]
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
                  void api.unsend(message.guid).then(() => upsert({ ...message, retracted: true }));
                },
              },
            ]
          : []),
      ];
      if (actions.length > 0) showSheet({ actions });
    },
    [chatGuid, privateApi, showSheet, upsert],
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerOffset}
    >
      {loading && messages.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          ref={listRef}
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
          contentContainerStyle={{ paddingVertical: 10 }}
          renderItem={({ item }) => (
            <View>
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
                  onLongPress={openMessageSheet}
                  onRetry={retry}
                />
              )}
            </View>
          )}
        />
      )}
      <Composer
        chatGuid={chatGuid}
        replyTo={replyTo}
        editing={editing}
        onClearReply={() => setReplyTo(null)}
        onClearEditing={() => setEditing(null)}
        onEdited={upsert}
        onOptimistic={upsert}
        onSettled={replaceTemp}
        onSent={upsert}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
