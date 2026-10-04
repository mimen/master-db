import { runCommand } from "@/lib/convex-commands";
import { messagingCommandError } from "@/lib/messaging-api";
import { useQuery } from "convex/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Reanimated, {
  FadeIn,
  FadeInUp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { aiApi, shelfSuggestions } from "@/lib/ai-api";
import { calendarTemplateUrl, eventShelfLabel } from "@/lib/calendar-link";
import { openExternalUrl } from "@/lib/external-link";
import { fillComposer } from "@/lib/composer-fill";
import { useServerEvents } from "@/lib/sse";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { useType } from "@/hooks/use-type";
import { useSuggestionMode, useSuggestionModel } from "@/lib/settings";
import { useActionSheet } from "@/lib/action-sheet";
import { showToast } from "@/lib/toast";
import { TAPBACK_EMOJI } from "./bubble";
import type { ReplySuggestion, ReplySuggestions, SuggestionModel } from "@shared/types";

// BlueBubbles' DB lags the SSE event; regenerating immediately would answer
// the previous message.
// ponytail: fixed delay, compare basedOnMessageGuid to the event guid if lag outgrows it.
const AUTO_REFRESH_DELAY_MS = 1500;

/**
 * Precomputed suggestions for this chat when they answer its current last
 * message. `undefined` while Convex is still answering, `null` to fall back to
 * the on-demand fetch (nothing precomputed or a stale anchor).
 */
function usePrecomputedSuggestions(chatGuid: string, model: SuggestionModel): ReplySuggestions | null | undefined {
  const row = useQuery(aiApi.getSuggestions, { chatGuid, model });
  return useMemo(() => shelfSuggestions(row), [row]);
}

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
  const type = useType();
  const { wide } = useLayoutMode();
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
  const autoRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Convex mode: the bridge precomputes suggestions for the newest inbound
  // message, so a fresh one renders instantly instead of after a model call.
  const precomputed = usePrecomputedSuggestions(chatGuid, selectedModel);

  useEffect(() => {
    activeRequest.current++;
    messageEpoch.current = 0;
    if (autoRefresh.current) clearTimeout(autoRefresh.current);
    setResult(null);
    setLoading(false);
    setResolved(false);
    setStale(false);
    setFailed(false);
    if (!enabled || !awaitingReply || mode !== "auto") return;
    if (precomputed === undefined) return;
    if (precomputed) {
      setResult(precomputed);
      setResolved(true);
      return;
    }
    void load(false);
  }, [chatGuid, enabled, awaitingReply, mode, selectedModel, load, precomputed]);

  useEffect(() => () => {
    if (autoRefresh.current) clearTimeout(autoRefresh.current);
  }, []);

  useServerEvents(
    useCallback(
      (event) => {
        if (event.kind !== "new-message" || event.chatGuid !== chatGuid) return;
        messageEpoch.current++;
        setStale(true);
        if (event.message.isFromMe) return;
        if (mode !== "auto" || !enabled || !awaitingReply) return;
        if (autoRefresh.current) clearTimeout(autoRefresh.current);
        autoRefresh.current = setTimeout(() => void load(false), AUTO_REFRESH_DELAY_MS);
      },
      [chatGuid, mode, enabled, awaitingReply, load],
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
          void runCommand(chatGuid, {
            kind: "react", messageGuid: suggestion.targetMessageGuid!, remove: false,
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
          }).catch((error: unknown) => showToast(messagingCommandError(error, "Reaction failed")));
        },
      }],
    });
  };

  if (!enabled || !awaitingReply || mode === "off") return null;
  const suggestions = result?.suggestions ?? [];
  const event = result?.event ?? null;
  const eventUrl = event ? calendarTemplateUrl(event) : null;
  const shelf = { borderTopColor: theme.divider, backgroundColor: theme.background };
  const pillText = { fontSize: type.secondary, lineHeight: Math.round(type.secondary * 1.3) };


  if (mode === "on-demand" && !resolved && !loading && !failed) {
    return (
      <View style={[styles.container, shelf]}>
        <GhostPill icon="sparkles" label="Suggest replies" accent onPress={() => void load(true)} />
      </View>
    );
  }
  if (failed && !loading) {
    return (
      <View style={[styles.container, shelf]}>
        <GhostPill icon="refresh" label="Retry suggestions" onPress={() => void load(true)} />
      </View>
    );
  }
  if (!loading && suggestions.length === 0 && !eventUrl) return null;

  const modelName = result
    ? `${result.servedModel === "opus" ? "Opus" : "Terra"}${result.fallback ? " (fallback)" : ""}`
    : null;

  return (
    <View style={[styles.container, styles.shelfRow, shelf]}>
      {loading ? (
        <SkeletonPills wide={wide} />
      ) : (
        <PillRow wide={wide}>
          {event && eventUrl && (
            <Reanimated.View entering={FadeInUp.springify().damping(20)} style={styles.pillWrap}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add to calendar: ${event.title}, ${eventShelfLabel(event)}`}
                disabled={stale}
                onPress={() => void openExternalUrl(eventUrl)}
                style={({ hovered, pressed }) => [
                  styles.pill,
                  styles.eventPill,
                  { backgroundColor: theme.background, borderColor: theme.accent, opacity: stale ? 0.5 : 1 },
                  !stale && hovered && !pressed && { backgroundColor: theme.backgroundElement },
                  !stale && pressed && { backgroundColor: theme.backgroundSelected },
                ]}
              >
                {() => <>
                  <Ionicons name="calendar-outline" size={15} color={theme.accent} />
                  <Text numberOfLines={wide ? 2 : 1} style={[styles.pillText, pillText, { color: theme.text }]}>
                    <Text style={styles.eventTitle}>{event.title}</Text>
                    {`  ·  ${eventShelfLabel(event)}`}
                  </Text>
                </>}
              </Pressable>
            </Reanimated.View>
          )}
          {suggestions.map((suggestion, index) => {
            const emoji = suggestion.reaction ? TAPBACK_EMOJI.get(suggestion.reaction) : null;
            return (
              <Reanimated.View
                key={suggestion.id}
                entering={FadeInUp.delay((index + (eventUrl ? 1 : 0)) * 50).springify().damping(20)}
                style={styles.pillWrap}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${suggestion.strategy}, ${suggestion.vibe}: ${suggestion.text}`}
                  disabled={stale}
                  onPress={() => suggestion.kind === "reaction" ? confirmReaction(suggestion) : applyTextSuggestion(suggestion)}
                  style={({ hovered, pressed }) => [
                    styles.pill,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder, opacity: stale ? 0.5 : 1 },
                    !stale && hovered && !pressed && { backgroundColor: theme.backgroundSelected },
                    !stale && pressed && { backgroundColor: theme.backgroundSelected, opacity: 0.8 },
                  ]}
                >
                  {() => <>
                    {emoji && <Text style={styles.reactionEmoji}>{emoji}</Text>}
                    <Text numberOfLines={wide ? 3 : 1} style={[styles.pillText, pillText, { color: theme.text }]}>
                      {suggestion.text}
                    </Text>
                  </>}
                </Pressable>
              </Reanimated.View>
            );
          })}
        </PillRow>
      )}
      {!loading && (
        <Reanimated.View entering={FadeIn.delay(150)}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={stale ? "New message, refresh suggestions" : `Regenerate suggestions${modelName ? `, from ${modelName}` : ""}`}
            onPress={() => void load(true)}
            onLongPress={modelName ? () => showToast(`Suggested by ${modelName}`) : undefined}
            hitSlop={10}
            style={({ hovered, pressed }) => [
              styles.refresh,
              hovered && !pressed && { backgroundColor: theme.backgroundElement },
              pressed && { backgroundColor: theme.backgroundSelected },
            ]}
          >
            {({ hovered, pressed }) => (
              <Ionicons
                name="refresh"
                size={14}
                color={stale ? theme.accent : hovered || pressed ? theme.text : theme.textSecondary}
                style={{ opacity: stale || hovered || pressed ? 1 : 0.55 }}
              />
            )}
          </Pressable>
        </Reanimated.View>
      )}
    </View>
  );
}

function PillRow({ wide, children }: { wide: boolean; children: ReactNode }): React.JSX.Element {
  return wide ? <View style={styles.pillRow}>{children}</View> : <PillScroller>{children}</PillScroller>;
}

// Phone: one row that scrolls sideways instead of stacking three rows tall.
function PillScroller({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.scroller}
      contentContainerStyle={styles.scrollRow}
    >
      {children}
    </ScrollView>
  );
}

// Sized like a typical reply set so the real pills land where the
// placeholders were and the shelf does not change height.
const SKELETON_WIDTHS = [132, 96, 156] as const;

function SkeletonPills({ wide }: { wide: boolean }): React.JSX.Element {
  return (
    <View
      accessibilityLabel="Loading reply suggestions"
      accessibilityLiveRegion="polite"
      role="status"
      style={[styles.pillRow, !wide && styles.noWrap]}
    >
      {SKELETON_WIDTHS.map((width, index) => <SkeletonPill key={width} width={width} index={index} />)}
    </View>
  );
}

function SkeletonPill({ width, index }: { width: number; index: number }): React.JSX.Element {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const glow = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    glow.value = withDelay(index * 160, withRepeat(withTiming(1, { duration: 900 }), -1, true));
  }, [glow, index, reduceMotion]);
  const breathe = useAnimatedStyle(() => ({ opacity: 0.45 + glow.value * 0.55 }));
  return (
    <Reanimated.View
      style={[
        styles.pill,
        styles.skeleton,
        { width, backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder },
        breathe,
      ]}
    />
  );
}

function GhostPill({ icon, label, accent = false, onPress }: {
  icon: "sparkles" | "refresh";
  label: string;
  accent?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const type = useType();
  const rest = accent ? theme.accent : theme.textSecondary;
  return (
    <Reanimated.View entering={FadeIn} style={styles.pillWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ hovered, pressed }) => [
          styles.pill,
          styles.ghost,
          { borderColor: theme.cardBorder },
          hovered && !pressed && { backgroundColor: theme.backgroundElement },
          pressed && { backgroundColor: theme.backgroundSelected },
        ]}
      >
        {({ hovered, pressed }) => <>
          <Ionicons name={icon} size={14} color={hovered || pressed ? theme.text : rest} />
          <Text style={[styles.ghostText, { color: hovered || pressed ? theme.text : rest, fontSize: type.secondary }]}>
            {label}
          </Text>
        </>}
      </Pressable>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  container: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8 },
  shelfRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  pillRow: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pillWrap: { maxWidth: "100%" },
  scroller: { flex: 1 },
  scrollRow: { flexDirection: "row", gap: 8 },
  noWrap: { flexWrap: "nowrap", overflow: "hidden" },
  eventPill: { borderWidth: 1 },
  pill: { borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, minHeight: 34, paddingHorizontal: 12, paddingVertical: 8, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 7 },
  skeleton: { height: 34 },
  ghost: { alignSelf: "flex-start", gap: 6, paddingHorizontal: 11 },
  ghostText: { fontWeight: "500" },
  refresh: { alignItems: "center", borderRadius: 13, height: 26, justifyContent: "center", marginTop: 4, width: 26 },
  eventTitle: { fontWeight: "600" },
  pillText: { flexShrink: 1 },
  reactionEmoji: { fontSize: 15, lineHeight: 17 },
});
