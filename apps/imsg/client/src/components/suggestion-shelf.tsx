import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { fillComposer } from "@/lib/composer-fill";
import { useServerEvents } from "@/lib/sse";
import { useTheme } from "@/hooks/use-theme";
import { useSuggestionMode } from "@/lib/settings";

/**
 * Reply-suggestion shelf, above the composer on desktop.
 *
 * Trigger policy is a user setting (settings.ts):
 *   - off:       never shown.
 *   - on-demand: shows a "Suggest a reply" button; nothing is generated until tapped.
 *   - auto:      generates once when the chat opens, then serves cache.
 * A new inbound message marks the shelf stale rather than regenerating, so a
 * burst costs nothing until Milad taps refresh. Tapping a suggestion fills the
 * composer for editing; it is never sent.
 */
interface SuggestionShelfProps {
  chatGuid: string;
  enabled: boolean;
  /** Only suggest when the last message is theirs — i.e. Milad owes a reply. */
  awaitingReply: boolean;
}

export function SuggestionShelf({ chatGuid, enabled, awaitingReply }: SuggestionShelfProps) {
  const theme = useTheme();
  const mode = useSuggestionMode();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState(false);
  // Guards against a slow response for a previous chat landing in a new one.
  const activeGuid = useRef(chatGuid);

  const load = useCallback(
    async (refresh: boolean) => {
      activeGuid.current = chatGuid;
      setLoading(true);
      setFailed(false);
      try {
        const result = await api.aiSuggestions(chatGuid, refresh);
        if (activeGuid.current !== chatGuid) return;
        setSuggestions(result.suggestions);
        setStale(result.stale);
      } catch {
        if (activeGuid.current === chatGuid) setFailed(true);
      } finally {
        if (activeGuid.current === chatGuid) setLoading(false);
      }
    },
    [chatGuid],
  );

  // Reset per chat. In auto mode, generate immediately when Milad owes a reply;
  // in on-demand mode, wait for the button. Opening a thread he has already
  // answered shows nothing either way.
  useEffect(() => {
    setSuggestions([]);
    setStale(false);
    setFailed(false);
    if (!enabled || !awaitingReply || mode !== "auto") return;
    void load(false);
  }, [chatGuid, enabled, awaitingReply, mode, load]);

  // A new message for this chat marks the shelf stale — no automatic refetch.
  useServerEvents(
    useCallback(
      (event) => {
        if (event.kind === "new-message" && event.chatGuid === chatGuid) setStale(true);
      },
      [chatGuid],
    ),
  );

  if (!enabled || !awaitingReply || mode === "off") return null;

  // On-demand, nothing generated yet: offer the button instead of the shelf.
  if (mode === "on-demand" && suggestions.length === 0 && !loading && !failed) {
    return (
      <View style={[styles.container, { borderTopColor: theme.divider, backgroundColor: theme.background }]}>
        <Pressable onPress={() => void load(true)} style={styles.demandButton} hitSlop={6}>
          <Ionicons name="sparkles-outline" size={15} color={theme.accent} />
          <Text style={{ color: theme.accent, fontSize: 13, fontWeight: "500" }}>Suggest a reply</Text>
        </Pressable>
      </View>
    );
  }

  // Nothing to show yet and nothing wrong: stay out of the way until first load.
  if (!loading && !failed && suggestions.length === 0) return null;

  return (
    <View style={[styles.container, { borderTopColor: theme.divider, backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Ionicons name="sparkles-outline" size={13} color={theme.textSecondary} />
        <Text style={[styles.label, { color: theme.textSecondary }]}>
          {failed ? "Suggestions unavailable" : stale ? "New message — refresh" : "Suggestions"}
        </Text>
        <Pressable onPress={() => void load(true)} disabled={loading} hitSlop={8} style={styles.refresh}>
          <Ionicons
            name="refresh"
            size={15}
            color={loading ? theme.textSecondary : theme.accent}
          />
        </Pressable>
      </View>

      {loading && suggestions.length === 0 ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Thinking…</Text>
        </View>
      ) : (
        <View style={styles.pillRow}>
          {suggestions.map((text, i) => (
            <Pressable
              key={`${i}-${text.slice(0, 12)}`}
              onPress={() => fillComposer(text)}
              style={[
                styles.pill,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.divider,
                  opacity: stale ? 0.55 : 1,
                },
              ]}
            >
              <Text numberOfLines={2} style={[styles.pillText, { color: theme.text }]}>
                {text}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    flex: 1,
  },
  refresh: {
    padding: 2,
  },
  demandButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
    paddingBottom: 8,
  },
  loadingText: {
    fontSize: 13,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingBottom: 6,
  },
  pill: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: "100%",
  },
  pillText: {
    fontSize: 14,
    lineHeight: 18,
  },
});
