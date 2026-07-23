import type { ChatSummary } from "@shared/types";

/** Matches forward.tsx's original hard cap on rendered rows. */
const MAX_RESULTS = 40;

/**
 * Pure filter for the forward-target picker: chats whose display name
 * contains `query` (case-insensitive, trimmed), capped at MAX_RESULTS. An
 * empty query returns the (capped) full list, same as the original inline
 * implementation in app/forward.tsx.
 */
export function filterForwardTargets(chats: ChatSummary[], query: string): ChatSummary[] {
  const needle = query.trim().toLowerCase();
  const matched = needle ? chats.filter((c) => c.displayName.toLowerCase().includes(needle)) : chats;
  return matched.slice(0, MAX_RESULTS);
}
