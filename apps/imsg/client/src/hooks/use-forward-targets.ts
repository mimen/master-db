import { useMemo, useState } from "react";
import { useChats } from "@/hooks/use-chats";
import { filterForwardTargets } from "@/lib/forward-targets";
import type { ChatSummary } from "@shared/types";

export interface UseForwardTargetsResult {
  query: string;
  setQuery: (query: string) => void;
  results: ChatSummary[];
  loading: boolean;
}

/**
 * Forward-target picker for app/forward.tsx: filters the app's
 * already-fetched chat list (via useChats) by display name, entirely
 * client-side — no network request per keystroke, no debounce needed. The
 * pure filter lives in lib/forward-targets.ts so it's testable without
 * pulling in react-native.
 */
export function useForwardTargets(): UseForwardTargetsResult {
  // "known", not "all": forwarding should not offer junk or unrecognised
  // numbers as targets, and "all" now includes both.
  const { chats, loading } = useChats("all", "known");
  const [query, setQuery] = useState("");
  const results = useMemo(() => filterForwardTargets(chats, query), [chats, query]);
  return { query, setQuery, results, loading };
}
