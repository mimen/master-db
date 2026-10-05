import type { ReplySuggestion } from "@shared/types";
import type { SuggestionMode } from "./settings-values";

/** Where the composer puts reply suggestions: the ghost text in the field and the alternates under it. */
export type SuggestionSlots =
  | { kind: "hidden" }
  /** On-demand mode before the first request. */
  | { kind: "offer" }
  | { kind: "failed" }
  /** A slow model call: placeholders hold the alternates row. */
  | { kind: "loading" }
  | {
      kind: "ready";
      /** The top text suggestion. Null while stale: it answers an older message. */
      ghost: ReplySuggestion | null;
      /** ⌥1 to ⌥3, in order. */
      alternates: readonly ReplySuggestion[];
      stale: boolean;
    };

export const MAX_ALTERNATES = 3;

export function suggestionSlots(input: {
  enabled: boolean;
  awaitingReply: boolean;
  mode: SuggestionMode;
  resolved: boolean;
  loading: boolean;
  failed: boolean;
  showSkeleton: boolean;
  stale: boolean;
  suggestions: readonly ReplySuggestion[];
  hasEvent: boolean;
}): SuggestionSlots {
  const { loading, stale, suggestions } = input;
  if (!input.enabled || !input.awaitingReply || input.mode === "off") return { kind: "hidden" };
  if (input.mode === "on-demand" && !input.resolved && !loading && !input.failed) return { kind: "offer" };
  if (input.failed && !loading) return { kind: "failed" };
  if (loading && !stale) return input.showSkeleton ? { kind: "loading" } : { kind: "hidden" };
  if (suggestions.length === 0 && !input.hasEvent) return { kind: "hidden" };
  const ghost = stale ? null : suggestions.find((suggestion) => suggestion.kind === "text") ?? null;
  return {
    kind: "ready",
    ghost,
    alternates: suggestions.filter((suggestion) => suggestion !== ghost).slice(0, MAX_ALTERNATES),
    stale,
  };
}

/** ⌥1 to ⌥3 by physical key, so Option's dead-key characters (¡ ™ £) never matter. */
export function alternateIndexForKey(event: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; code: string }): number | null {
  if (!event.altKey || event.metaKey || event.ctrlKey) return null;
  const match = /^Digit([1-9])$/.exec(event.code);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index < MAX_ALTERNATES ? index : null;
}
