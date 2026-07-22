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

interface Row extends ShadowMessage {
  pending?: boolean;
}

export function ShadowPanel({ chatGuid, onClose }: ShadowPanelProps) {
  const theme = useTheme();
  const [rows, setRows] = useState<Row[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<FlatList<Row>>(null);
  const inputRef = useRef<TextInput>(null);
  const activeGuid = useRef(chatGuid);

  useEffect(() => {
    activeGuid.current = chatGuid;
    setLoading(true);
    setRows([]);
    api
      .aiShadowHistory(chatGuid)
      .then((history) => {
        if (activeGuid.current === chatGuid) setRows(history);
      })
      .catch(() => undefined)
      .finally(() => {
        if (activeGuid.current === chatGuid) setLoading(false);
      });
  }, [chatGuid]);

  const send = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const now = Date.now();
    const userRow: Row = { id: `local-${now}`, role: "user", text: trimmed, createdAt: now };
    const thinkingRow: Row = {
      id: `pending-${now}`,
      role: "assistant",
      text: "",
      createdAt: now + 1,
      pending: true,
    };
    setRows((prev) => [...prev, userRow, thinkingRow]);
    setText("");
    setSending(true);
    try {
      const { reply } = await api.aiShadowSend(chatGuid, trimmed);
      if (activeGuid.current !== chatGuid) return;
      setRows((prev) =>
        prev.map((r) =>
          r.id === thinkingRow.id ? { ...r, text: reply, pending: false } : r,
        ),
      );
    } catch {
      if (activeGuid.current !== chatGuid) return;
      // Drop the thinking row and restore the user's text so it can be retried.
      setRows((prev) => prev.filter((r) => r.id !== thinkingRow.id && r.id !== userRow.id));
      setText(trimmed);
      showToast("Assistant unavailable");
    } finally {
      if (activeGuid.current === chatGuid) setSending(false);
    }
  }, [chatGuid, text, sending]);

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
    if (rows.length > 0) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, [rows.length]);

  const clear = () => {
    api.aiShadowClear(chatGuid).catch(() => undefined);
    setRows([]);
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
      ) : rows.length === 0 ? (
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
        />
      )}

      <View style={[styles.inputRow, { borderTopColor: theme.divider }]}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder="Ask the assistant…"
          placeholderTextColor={theme.textSecondary}
          multiline
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <Pressable
          onPress={() => void send()}
          disabled={!text.trim() || sending}
          style={[
            styles.sendButton,
            { backgroundColor: text.trim() && !sending ? theme.accent : theme.backgroundElement },
          ]}
        >
          <Ionicons name="arrow-up" size={18} color={text.trim() && !sending ? "#fff" : theme.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

function ShadowRow({ row }: { row: Row }) {
  const theme = useTheme();
  const mine = row.role === "user";
  return (
    <View style={[styles.bubbleWrap, mine ? styles.bubbleRight : styles.bubbleLeft]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: mine ? theme.bubbleMine : theme.bubbleTheirs,
            borderBottomRightRadius: mine ? 4 : 16,
            borderBottomLeftRadius: mine ? 16 : 4,
          },
        ]}
      >
        {row.pending ? (
          <ActivityIndicator size="small" color={theme.textSecondary} />
        ) : (
          <Text style={{ color: mine ? "#fff" : theme.bubbleTheirsText, fontSize: 14, lineHeight: 19 }}>
            {row.text}
          </Text>
        )}
      </View>
      {!mine && !row.pending && row.text.length > 0 && (
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
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    flex: 1,
    fontSize: 15,
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
