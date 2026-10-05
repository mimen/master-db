import { runCommand } from "@/lib/convex-commands";
import { messagingCommandError } from "@/lib/messaging-api";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Reanimated, { FadeIn } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { aiApi, shelfSuggestions } from "@/lib/ai-api";
import { calendarTemplateUrl, eventShelfLabel } from "@/lib/calendar-link";
import { openExternalUrl } from "@/lib/external-link";
import { fillComposer } from "@/lib/composer-fill";
import { commaApi } from "@/lib/convex-api";
import { useTheme } from "@/hooks/use-theme";
import { useSuggestionMode, useSuggestionModel } from "@/lib/settings";
import { useActionSheet } from "@/lib/action-sheet";
import { showToast } from "@/lib/toast";
import { alternateIndexForKey, suggestionSlots, type SuggestionSlots } from "@/lib/suggestion-slots";
import { TAPBACK_EMOJI } from "./bubble";
import type { EventSuggestion, ReplySuggestion, ReplySuggestions, SuggestionModel } from "@shared/types";

/**
 * Precomputed suggestions for this chat when they answer its current last
 * message. `undefined` while Convex is still answering, `null` to fall back to
 * the on-demand fetch (nothing precomputed or a stale anchor).
 */
function usePrecomputedSuggestions(chatGuid: string, model: SuggestionModel): ReplySuggestions | null | undefined {
  const row = useQuery(aiApi.getSuggestions, { chatGuid, model });
  return useMemo(() => shelfSuggestions(row), [row]);
}

export interface SuggestionSource {
  enabled: boolean;
  awaitingReply: boolean;
  reactionSuggestions: boolean;
  reactionPreview: (messageGuid: string) => string;
}

export interface ReplySuggestionsState {
  slots: SuggestionSlots;
  /** A text suggestion fills the composer; a reaction asks for confirmation first. Never sends text. */
  apply: (suggestion: ReplySuggestion) => void;
  load: () => void;
  modelName: string | null;
  event: { event: EventSuggestion; url: string } | null;
}

// Most suggestions resolve from precomputed rows in a few hundred ms; placeholders appear only
// for a slow model call, so a thread open does not flash gray bars.
const SKELETON_DELAY_MS = 600;

export function useReplySuggestions(
  chatGuid: string,
  { enabled, awaitingReply, reactionSuggestions, reactionPreview }: SuggestionSource,
): ReplySuggestionsState {
  const mode = useSuggestionMode();
  const selectedModel = useSuggestionModel();
  const showSheet = useActionSheet();
  const [result, setResult] = useState<ReplySuggestions | null>(null);
  const currentResult = useRef(result);
  currentResult.current = result;
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [resolved, setResolved] = useState(false);
  const activeRequest = useRef(0);
  const conversation = useQuery(commaApi.resolveChat, { chatGuid });
  const anchorGuid = conversation?.lastMessage?.guid;
  const currentAnchor = useRef(anchorGuid);
  currentAnchor.current = anchorGuid;
  const stale = !!result && (result.stale || !anchorGuid || result.basedOnMessageGuid !== anchorGuid);
  const [showSkeleton, setShowSkeleton] = useState(false);
  useEffect(() => {
    if (!loading) { setShowSkeleton(false); return; }
    const timer = setTimeout(() => setShowSkeleton(true), SKELETON_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  const fetchSuggestions = useCallback(
    async (refresh: boolean) => {
      const requestId = ++activeRequest.current;
      const startedAtAnchor = currentAnchor.current;
      setLoading(true);
      setFailed(false);
      try {
        const next = await api.aiSuggestions(chatGuid, selectedModel, refresh);
        if (activeRequest.current !== requestId) return;
        setResult({ ...next, stale: next.stale || currentAnchor.current !== startedAtAnchor });
        setResolved(true);
      } catch {
        if (activeRequest.current === requestId) setFailed(true);
      } finally {
        if (activeRequest.current === requestId) setLoading(false);
      }
    },
    [chatGuid, selectedModel],
  );

  // The bridge precomputes suggestions for the newest inbound message, so a fresh one renders
  // instantly instead of after a model call.
  const precomputed = usePrecomputedSuggestions(chatGuid, selectedModel);

  useEffect(() => {
    activeRequest.current++;
    currentResult.current = null;
    setResult(null);
    setLoading(false);
    setResolved(false);
    setFailed(false);
  }, [chatGuid, enabled, awaitingReply, mode, selectedModel]);

  useEffect(() => {
    if (!enabled || !awaitingReply || mode !== "auto" || !anchorGuid || precomputed === undefined) return;
    if (precomputed) {
      // A delayed copy of the displayed set must not clear a manual refresh failure or replace
      // its pending request.
      const displayed = currentResult.current;
      if (displayed && !displayed.stale && displayed.basedOnMessageGuid === precomputed.basedOnMessageGuid &&
        displayed.generatedAt >= precomputed.generatedAt) return;
      activeRequest.current++;
      setResult(precomputed);
      setResolved(true);
      setLoading(false);
      setFailed(false);
    } else {
      void fetchSuggestions(false);
    }
  }, [chatGuid, enabled, awaitingReply, mode, selectedModel, anchorGuid, precomputed, fetchSuggestions]);

  useEffect(() => {
    const request = activeRequest;
    return () => { request.current++; };
  }, []);

  const confirmReaction = (suggestion: ReplySuggestion, from: ReplySuggestions): void => {
    if (!reactionSuggestions || !suggestion.reaction || !suggestion.targetMessageGuid) return;
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
              selectedModel: from.selectedModel,
              servedModel: from.servedModel,
              recipeVersion: from.recipeVersion,
              selectedAt: Date.now(),
              finalText: suggestion.text,
            }).catch(() => undefined);
          }).catch((error: unknown) => showToast(messagingCommandError(error, "Reaction failed")));
        },
      }],
    });
  };

  const apply = (suggestion: ReplySuggestion): void => {
    if (!result || stale) return;
    if (suggestion.kind === "reaction") {
      confirmReaction(suggestion, result);
      return;
    }
    fillComposer(suggestion.text, {
      suggestion,
      selectedModel: result.selectedModel,
      servedModel: result.servedModel,
      recipeVersion: result.recipeVersion,
      selectedAt: Date.now(),
    });
  };

  const event = result?.event ?? null;
  const eventUrl = event ? calendarTemplateUrl(event) : null;
  return {
    slots: suggestionSlots({
      enabled, awaitingReply, mode, resolved, loading, failed, showSkeleton, stale,
      suggestions: result?.suggestions ?? [], hasEvent: !!eventUrl,
    }),
    apply,
    load: () => void fetchSuggestions(true),
    modelName: result ? `${result.servedModel === "opus" ? "Opus" : "Terra"}${result.fallback ? " (fallback)" : ""}` : null,
    event: event && eventUrl ? { event, url: eventUrl } : null,
  };
}

/**
 * The alternates under the composer. Desktop: keyboard-labeled text links, ⌥1 to ⌥3. Phone: chips
 * in one sideways-scrolling row. The same row carries the on-demand request, a retry, the
 * placeholders for a slow call, a calendar event and the refresh control.
 */
export function SuggestionAlternates({ state, wide }: { state: ReplySuggestionsState; wide: boolean }): React.JSX.Element | null {
  const theme = useTheme();
  const { slots, apply, load, modelName, event } = state;
  const alternates = slots.kind === "ready" ? slots.alternates : [];
  const stale = slots.kind === "ready" && slots.stale;
  const current = useRef({ apply, alternates });
  current.current = { apply, alternates };
  const listening = Platform.OS === "web" && wide && alternates.length > 0;

  useEffect(() => {
    if (!listening || typeof window === "undefined") return;
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      const index = alternateIndexForKey(keyEvent);
      const suggestion = index === null ? undefined : current.current.alternates[index];
      if (!suggestion) return;
      // Option+digit would otherwise type ¡ ™ £ into the field.
      keyEvent.preventDefault();
      current.current.apply(suggestion);
    };
    // Capture: the field's own handlers stop the bubble before it reaches the window.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [listening]);

  if (slots.kind === "hidden") return null;
  const Row = wide ? DeskRow : PhoneRow;

  if (slots.kind === "offer") {
    return <Row><Alternate wide={wide} icon="sparkles" label="Suggest replies" accent onPress={load} /></Row>;
  }
  if (slots.kind === "failed") {
    return <Row><Alternate wide={wide} icon="refresh" label="Retry suggestions" onPress={load} /></Row>;
  }
  if (slots.kind === "loading") {
    return (
      <View accessibilityLabel="Loading reply suggestions" accessibilityLiveRegion="polite" role="status">
        <Row>
          {SKELETON_WIDTHS.map((width) => (
            <View key={width} style={[wide ? styles.deskSkeleton : styles.chip, { width: wide ? width * 0.7 : width, backgroundColor: theme.skeleton }]} />
          ))}
        </Row>
      </View>
    );
  }

  return (
    <Row>
      {event && (
        <Alternate
          wide={wide}
          icon="calendar-outline"
          label={`${event.event.title} · ${eventShelfLabel(event.event)}`}
          accessibilityLabel={`Add to calendar: ${event.event.title}, ${eventShelfLabel(event.event)}`}
          disabled={stale}
          onPress={() => void openExternalUrl(event.url)}
        />
      )}
      {alternates.map((suggestion, index) => {
        const emoji = suggestion.reaction ? TAPBACK_EMOJI.get(suggestion.reaction) : undefined;
        return (
          <Alternate
            key={suggestion.id}
            wide={wide}
            shortcut={`⌥${index + 1}`}
            label={emoji ? `${emoji} ${suggestion.text}` : suggestion.text}
            accessibilityLabel={`${suggestion.strategy}, ${suggestion.vibe}: ${suggestion.text}`}
            disabled={stale}
            onPress={() => apply(suggestion)}
          />
        );
      })}
      <Reanimated.View entering={FadeIn.delay(150)} style={wide ? styles.deskRefresh : undefined}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={stale ? "New message, refresh suggestions" : `Regenerate suggestions${modelName ? `, from ${modelName}` : ""}`}
          onPress={load}
          onLongPress={modelName ? () => showToast(`Suggested by ${modelName}`) : undefined}
          hitSlop={10}
          style={({ hovered, pressed }) => [styles.refresh, (hovered || pressed) && { backgroundColor: theme.rowHover }]}
        >
          {({ hovered, pressed }) => (
            <Ionicons name="refresh" size={14} color={stale ? theme.accent : hovered || pressed ? theme.text : theme.textTertiary} />
          )}
        </Pressable>
      </Reanimated.View>
    </Row>
  );
}

const SKELETON_WIDTHS = [132, 96, 156] as const;

function DeskRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <View testID="suggestion-alternates" style={styles.deskRow}>{children}</View>;
}

function PhoneRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ScrollView
      testID="suggestion-alternates"
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.phoneRow}
    >
      {children}
    </ScrollView>
  );
}

function Alternate({ wide, label, shortcut, icon, accent = false, disabled = false, accessibilityLabel, onPress }: {
  wide: boolean;
  label: string;
  shortcut?: string;
  icon?: "sparkles" | "refresh" | "calendar-outline";
  accent?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const rest = accent ? theme.accent : wide ? theme.textTertiary : theme.textSecondary;
  return (
    <Reanimated.View entering={FadeIn} style={styles.alternateWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        disabled={disabled}
        onPress={onPress}
        style={({ hovered, pressed }) => [
          wide ? styles.link : [styles.chip, { backgroundColor: theme.field }],
          { opacity: disabled ? 0.5 : 1 },
          !disabled && (hovered || pressed) && { backgroundColor: wide ? theme.rowHover : theme.rowSelected },
        ]}
      >
        {({ hovered, pressed }) => {
          const color = !disabled && (hovered || pressed) ? theme.text : rest;
          return <>
            {icon && <Ionicons name={icon} size={wide ? 13 : 15} color={color} />}
            {wide && shortcut && <Text style={[styles.shortcut, { color: theme.textSecondary }]}>{shortcut}</Text>}
            <Text numberOfLines={1} style={[wide ? styles.linkText : styles.chipText, { color }]}>{label}</Text>
          </>;
        }}
      </Pressable>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  // Tall enough for the refresh control, so placeholders and loaded links share one height.
  deskRow: { alignItems: "center", flexDirection: "row", gap: 6, minHeight: 30, paddingTop: 4 },
  phoneRow: { alignItems: "center", flexDirection: "row", gap: 8, minHeight: 42, paddingHorizontal: 4, paddingTop: 10 },
  alternateWrap: { flexShrink: 1, minWidth: 0 },
  link: { alignItems: "center", borderRadius: 6, flexDirection: "row", gap: 4, height: 24, paddingHorizontal: 6 },
  linkText: { flexShrink: 1, fontSize: 12 },
  shortcut: { fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "600" },
  chip: { alignItems: "center", borderRadius: 999, flexDirection: "row", gap: 6, height: 32, paddingHorizontal: 12 },
  chipText: { fontSize: 14 },
  deskSkeleton: { borderRadius: 4, height: 10, marginHorizontal: 6 },
  deskRefresh: { marginLeft: "auto" },
  refresh: { alignItems: "center", borderRadius: 13, height: 26, justifyContent: "center", width: 26 },
});
