import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { calendarTemplateUrl, eventShelfLabel } from "@/lib/calendar-link";
import { openExternalUrl } from "@/lib/external-link";
import { fillComposer } from "@/lib/composer-fill";
import { useServerEvents } from "@/lib/sse";
import { useTheme } from "@/hooks/use-theme";
import { useSuggestionMode, useSuggestionModel } from "@/lib/settings";
import { useActionSheet } from "@/lib/action-sheet";
import { showToast } from "@/lib/toast";
import { TAPBACK_EMOJI } from "./bubble";
import type { ReplySuggestion, ReplySuggestions, SuggestionVibe } from "@shared/types";

interface SuggestionShelfProps {
  chatGuid: string;
  enabled: boolean;
  awaitingReply: boolean;
  reactionSuggestions: boolean;
  reactionPreview: (messageGuid: string) => string;
}

export function SuggestionShelf({
  chatGuid,
  enabled,
  awaitingReply,
  reactionSuggestions,
  reactionPreview,
}: SuggestionShelfProps) {
  const theme = useTheme();
  const mode = useSuggestionMode();
  const selectedModel = useSuggestionModel();
  const showSheet = useActionSheet();
  const [result, setResult] = useState<ReplySuggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState(false);
  const [resolved, setResolved] = useState(false);
  const activeRequest = useRef(0);
  const messageEpoch = useRef(0);

  const load = useCallback(
    async (refresh: boolean) => {
      const requestId = ++activeRequest.current;
      const startedAtMessageEpoch = messageEpoch.current;
      setLoading(true);
      setFailed(false);
      try {
        const next = await api.aiSuggestions(chatGuid, selectedModel, refresh);
        if (activeRequest.current !== requestId) return;
        setResult(next);
        setResolved(true);
        setStale(next.stale || messageEpoch.current !== startedAtMessageEpoch);
      } catch {
        if (activeRequest.current === requestId) setFailed(true);
      } finally {
        if (activeRequest.current === requestId) setLoading(false);
      }
    },
    [chatGuid, selectedModel],
  );

  useEffect(() => {
    activeRequest.current++;
    messageEpoch.current = 0;
    setResult(null);
    setResolved(false);
    setStale(false);
    setFailed(false);
    if (!enabled || !awaitingReply || mode !== "auto") return;
    void load(false);
  }, [chatGuid, enabled, awaitingReply, mode, selectedModel, load]);

  useServerEvents(
    useCallback(
      (event) => {
        if (event.kind === "new-message" && event.chatGuid === chatGuid) {
          messageEpoch.current++;
          setStale(true);
        }
      },
      [chatGuid],
    ),
  );

  const applyTextSuggestion = (suggestion: ReplySuggestion): void => {
    if (!result || stale) return;
    fillComposer(suggestion.text, {
      suggestion,
      selectedModel: result.selectedModel,
      servedModel: result.servedModel,
      recipeVersion: result.recipeVersion,
      selectedAt: Date.now(),
    });
  };

  const confirmReaction = (suggestion: ReplySuggestion): void => {
    if (!result || stale || !reactionSuggestions || !suggestion.reaction || !suggestion.targetMessageGuid) return;
    const emoji = TAPBACK_EMOJI.get(suggestion.reaction) ?? suggestion.reaction;
    const loadedPreview = reactionPreview(suggestion.targetMessageGuid);
    const target = loadedPreview === "this message"
      ? (suggestion.targetMessagePreview ?? loadedPreview)
      : loadedPreview;
    showSheet({
      title: `${emoji}  ${target}`,
      actions: [{
        label: `React ${emoji}`,
        onPress: () => {
          void api.react(suggestion.targetMessageGuid!, {
            chatGuid,
            reaction: suggestion.reaction!,
            partIndex: suggestion.targetPartIndex ?? 0,
            suggested: true,
          }).then(() => {
            void api.recordSuggestionFeedback(chatGuid, {
              suggestion,
              selectedModel: result.selectedModel,
              servedModel: result.servedModel,
              recipeVersion: result.recipeVersion,
              selectedAt: Date.now(),
              finalText: suggestion.text,
            }).catch(() => undefined);
          }).catch(() => showToast("Reaction failed"));
        },
      }],
    });
  };

  if (!enabled || !awaitingReply || mode === "off") return null;
  const suggestions = result?.suggestions ?? [];
  const event = result?.event ?? null;
  const eventUrl = event ? calendarTemplateUrl(event) : null;
  if (mode === "on-demand" && !resolved && suggestions.length === 0 && !loading && !failed) {
    return (
      <View style={[styles.container, styles.demandRow, { borderTopColor: theme.divider, backgroundColor: theme.background }]}>
        <DemandButton onPress={() => void load(true)} />
      </View>
    );
  }
  if (!loading && !failed && suggestions.length === 0 && !eventUrl) return null;

  return (
    <View style={[styles.container, { borderTopColor: theme.divider, backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Ionicons name="sparkles-outline" size={13} color={theme.textSecondary} />
        <Text style={[styles.label, { color: theme.textSecondary }]}>
          {failed ? "Suggestions unavailable" : stale ? "New message — refresh" : "Suggestions"}
        </Text>
        {result && (
          <Text style={[styles.model, { color: theme.textSecondary }]}>
            {result.servedModel === "opus" ? "Opus" : "Terra"}{result.fallback ? " · fallback" : ""}
          </Text>
        )}
        <Pressable onPress={() => void load(true)} disabled={loading} hitSlop={8} style={styles.refresh}>
          {({ hovered, pressed }) => <Ionicons name="refresh" size={15} color={loading ? theme.textSecondary : hovered || pressed ? theme.text : theme.accent} />}
        </Pressable>
      </View>

      {loading && suggestions.length === 0 ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Thinking…</Text>
        </View>
      ) : (
        <View style={styles.pillRow}>
          {event && eventUrl && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add to calendar: ${event.title}, ${eventShelfLabel(event)}`}
              disabled={stale}
              onPress={() => void openExternalUrl(eventUrl)}
              style={({ hovered, pressed }) => [
                styles.pill,
                styles.eventPill,
                { opacity: stale ? 0.55 : 1 },
                !stale && (hovered || pressed) && styles.pillHover,
              ]}
            >
              {({ hovered, pressed }) => <>
                <Ionicons name="calendar-outline" size={15} color={theme.accent} />
                <Text numberOfLines={2} style={[styles.pillText, { color: theme.text }]}>
                  <Text style={styles.eventTitle}>{event.title}</Text>
                  {`  ·  ${eventShelfLabel(event)}`}
                </Text>
              </>}
            </Pressable>
          )}
          {suggestions.map((suggestion) => {
            const colors = vibeColors(suggestion.vibe);
            const emoji = suggestion.reaction ? TAPBACK_EMOJI.get(suggestion.reaction) : null;
            return (
              <Pressable
                key={suggestion.id}
                accessibilityRole="button"
                accessibilityLabel={`${suggestion.strategy}, ${suggestion.vibe}: ${suggestion.text}`}
                disabled={stale}
                onPress={() => suggestion.kind === "reaction" ? confirmReaction(suggestion) : applyTextSuggestion(suggestion)}
                style={({ hovered, pressed }) => [
                  styles.pill,
                  { backgroundColor: colors.background, borderColor: colors.border, opacity: stale ? 0.55 : 1 },
                  !stale && (hovered || pressed) && styles.pillHover,
                ]}
              >
                {({ hovered, pressed }) => <>
                  {emoji && <Text style={styles.reactionEmoji}>{emoji}</Text>}
                  <Text numberOfLines={3} style={[styles.pillText, { color: theme.text }]}>
                    {suggestion.text}
                  </Text>
                </>}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

type SuggestionColors = { background: string; border: string };

function vibeColors(vibe: SuggestionVibe): SuggestionColors {
  switch (vibe) {
    case "curious": return { background: "rgba(120,174,248,0.13)", border: "rgba(120,174,248,0.38)" };
    case "affirmative": return { background: "rgba(114,213,163,0.13)", border: "rgba(114,213,163,0.38)" };
    case "cautious": return { background: "rgba(239,191,104,0.13)", border: "rgba(239,191,104,0.38)" };
    case "boundary": return { background: "rgba(238,133,133,0.13)", border: "rgba(238,133,133,0.38)" };
    case "playful": return { background: "rgba(189,153,242,0.13)", border: "rgba(189,153,242,0.38)" };
  }
}

function DemandButton({ onPress }: { onPress: () => void }): React.JSX.Element {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Suggest a reply"
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.demandButton,
        Platform.OS === "web" ? ({ cursor: "pointer" } as object) : null,
        pressed && { opacity: 0.72 },
      ]}
    >
      <Ionicons name="sparkles-outline" size={15} color={hovered ? theme.text : theme.accent} />
      <Text style={{ color: hovered ? theme.text : theme.accent, fontSize: 13, fontWeight: "500", lineHeight: 16 }}>Suggest a reply</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  demandRow: { justifyContent: "center", minHeight: 44, paddingBottom: 8, paddingTop: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  label: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, flex: 1 },
  model: { fontSize: 10, fontWeight: "500" },
  refresh: { padding: 2 },
  demandButton: { alignItems: "center", alignSelf: "flex-start", borderRadius: 8, flexDirection: "row", gap: 6, paddingHorizontal: 8, paddingVertical: 7 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, paddingBottom: 8 },
  loadingText: { fontSize: 13 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 6 },
  pill: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 7 },
  pillHover: Platform.OS === "web" ? ({ filter: "brightness(1.32)" } as object) : {},
  eventPill: { backgroundColor: "rgba(94,199,221,0.13)", borderColor: "rgba(94,199,221,0.38)" },
  eventTitle: { fontWeight: "600" },
  pillText: { fontSize: 13, lineHeight: 17, flexShrink: 1 },
  reactionEmoji: { fontSize: 16 },
});
