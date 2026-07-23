import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { fillComposer } from "@/lib/composer-fill";
import { showToast } from "@/lib/toast";
import { useTheme } from "@/hooks/use-theme";
import type { ShadowMessage } from "@shared/types";

/**
 * Shadow conversation: a side panel for thinking and acting alongside an open
 * thread. Unlike the suggestion shelf, this talks to the harness lane — the
 * agent has full desktop context and can run tools. Nothing here is sent to the
 * other person; an assistant line can be pushed into the iMessage composer with
 * the arrow affordance, which fills it for editing (never auto-sends).
 *
 * Turns take ~8s, so the pending state is explicit and the input stays usable.
 */
interface ShadowPanelProps {
  chatGuid: string;
  onClose: () => void;
}

type Row = ShadowMessage;

// Assistant errors are persisted with a ⚠️ prefix so a failed turn is visible
// rather than silently missing.
function isError(text: string): boolean {
  return text.startsWith("⚠️");
}

export function ShadowPanel({ chatGuid, onClose }: ShadowPanelProps) {
  const theme = useTheme();
  const [rows, setRows] = useState<Row[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<FlatList<Row>>(null);
  const inputRef = useRef<TextInput>(null);
  const activeGuid = useRef(chatGuid);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  // History is the source of truth. Because the server persists the reply
  // whether or not the panel is open, refetching always catches a turn that
  // completed while we were away — polling just keeps an open panel live.
  const refresh = useCallback(
    (schedulePoll: boolean) => {
      api
        .aiShadowHistory(chatGuid)
        .then(({ messages, pending: serverPending }) => {
          if (activeGuid.current !== chatGuid) return;
          setRows(messages);
          setPending(serverPending);
          stopPolling();
          if (schedulePoll && serverPending) {
            pollTimer.current = setTimeout(() => refresh(true), 1500);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (activeGuid.current === chatGuid) setLoading(false);
        });
    },
    [chatGuid, stopPolling],
  );

  useEffect(() => {
    activeGuid.current = chatGuid;
    setLoading(true);
    setRows([]);
    setPending(false);
    refresh(true); // resumes polling if a turn is still running from before
    return stopPolling;
  }, [chatGuid, refresh, stopPolling]);

  const send = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    const now = Date.now();
    // Optimistic user bubble; the server persists the canonical copy, which the
    // next refresh reconciles against.
    setRows((prev) => [...prev, { id: `local-${now}`, role: "user", text: trimmed, createdAt: now }]);
    setText("");
    setPending(true);
    try {
      await api.aiShadowSend(chatGuid, trimmed);
      if (activeGuid.current === chatGuid) refresh(true);
    } catch {
      if (activeGuid.current !== chatGuid) return;
      setText(trimmed);
      setPending(false);
      showToast("Couldn't reach the assistant");
    }
  }, [chatGuid, text, pending, refresh]);

  // Desktop: Enter sends, Shift+Enter newlines (matches the main composer).
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = inputRef.current as unknown as HTMLTextAreaElement | null;
    if (!node?.addEventListener) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void send();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [send]);

  useEffect(() => {
    if (rows.length > 0 || pending) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, [rows.length, pending]);

  const clear = () => {
    stopPolling();
    api.aiShadowClear(chatGuid).catch(() => undefined);
    setRows([]);
    setPending(false);
  };

  return (
    <View style={styles.panel}>
      <View style={[styles.header, { borderBottomColor: theme.divider }]}>
        <Ionicons name="sparkles" size={15} color={theme.accent} />
        <Text style={[styles.headerTitle, { color: theme.text }]}>Assistant</Text>
        {rows.length > 0 && (
          <Pressable onPress={clear} hitSlop={6}>
            <Text style={{ color: theme.textSecondary, fontSize: 13 }}>Clear</Text>
          </Pressable>
        )}
        <Pressable onPress={onClose} hitSlop={6}>
          <Ionicons name="close" size={20} color={theme.textSecondary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : rows.length === 0 && !pending ? (
        <View style={styles.center}>
          <Ionicons name="sparkles-outline" size={26} color={theme.textSecondary} />
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
            Think through this conversation, look someone up, or ask me to do something.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <ShadowRow row={item} />}
          ListFooterComponent={
            // Shown whenever a turn is running — including after reopening a chat
            // whose turn is still in flight from before.
            pending && rows[rows.length - 1]?.role !== "assistant" ? (
              <View style={[styles.bubbleWrap, styles.bubbleLeft]}>
                <View
                  style={[
                    styles.bubble,
                    { backgroundColor: theme.bubbleTheirs, borderBottomLeftRadius: 4 },
                  ]}
                >
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                </View>
              </View>
            ) : null
          }
        />
      )}

      <View style={[styles.inputRow, { borderTopColor: theme.divider }]}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder={pending ? "Working…" : "Ask the assistant…"}
          placeholderTextColor={theme.textSecondary}
          multiline
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <Pressable
          onPress={() => void send()}
          disabled={!text.trim() || pending}
          style={[
            styles.sendButton,
            { backgroundColor: text.trim() && !pending ? theme.accent : theme.backgroundElement },
          ]}
        >
          <Ionicons name="arrow-up" size={18} color={text.trim() && !pending ? "#fff" : theme.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

function ShadowRow({ row }: { row: Row }) {
  const theme = useTheme();
  const mine = row.role === "user";
  const errored = !mine && isError(row.text);
  return (
    <View style={[styles.bubbleWrap, mine ? styles.bubbleRight : styles.bubbleLeft]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: errored ? theme.backgroundElement : mine ? theme.bubbleMine : theme.bubbleTheirs,
            borderBottomRightRadius: mine ? 4 : 16,
            borderBottomLeftRadius: mine ? 16 : 4,
          },
        ]}
      >
        <Text
          style={{
            color: errored ? theme.textSecondary : mine ? "#fff" : theme.bubbleTheirsText,
            fontSize: 14,
            lineHeight: 19,
          }}
        >
          {row.text}
        </Text>
      </View>
      {!mine && !errored && row.text.length > 0 && (
        // Push an assistant line into the iMessage composer for editing.
        <Pressable onPress={() => fillComposer(row.text)} hitSlop={6} style={styles.useButton}>
          <Ionicons name="arrow-redo-outline" size={13} color={theme.textSecondary} />
          <Text style={{ color: theme.textSecondary, fontSize: 11 }}>Use as message</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
  },
  header: {
    height: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  listContent: {
    padding: 12,
    gap: 10,
  },
  bubbleWrap: {
    maxWidth: "88%",
  },
  bubbleLeft: {
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },
  bubbleRight: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 34,
    justifyContent: "center",
  },
  useButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingTop: 4,
    paddingHorizontal: 4,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 9,
    fontSize: 14,
    maxHeight: 120,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
