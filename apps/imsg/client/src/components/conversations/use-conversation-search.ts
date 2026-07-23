import { useEffect, useMemo, useReducer, useRef } from "react";
import type { TextInput } from "react-native";

import { api } from "@/lib/api";
import {
  conversationSearchReducer,
  INITIAL_CONVERSATION_SEARCH,
  normalizeSearchQuery,
  usableDeepMatches,
  type DeepSearchState,
} from "@/lib/conversation-search";
import type { InboxFilters } from "@/lib/inbox-model";

export interface ConversationSearchController {
  readonly query: string;
  readonly normalizedQuery: string;
  /** Search is a MODE: nonblank query supersedes the lens badges. */
  readonly active: boolean;
  readonly deepSearch: DeepSearchState;
  /** Deep-match GUIDs valid for the CURRENT query (empty otherwise). */
  readonly deepMatches: ReadonlySet<string>;
  /** Changes exactly when the rendered view changes (lens or query) — the
   * pane watches this to start each new view from the top. */
  readonly viewKey: string;
  readonly inputRef: React.RefObject<TextInput | null>;

  setQuery(value: string): void;
  /** Clears search if active; returns whether anything was cleared (the
   * Esc-ladder uses this to decide whether Esc is consumed). */
  clear(): boolean;
  /** Badge tap: picking a lens exits search — the two never compose. */
  applyFilters(filters: InboxFilters): void;
}

/**
 * Messages-search policy: query state, lens wipe-on-type, and the debounced
 * deep message-body search — the side-effectful wrapper around the pure
 * reducer in lib/conversation-search.ts. This hook never scrolls; the pane
 * observes `viewKey` and drives the viewport itself.
 */
export function useConversationSearch(args: {
  readonly filters: InboxFilters;
  readonly onFiltersChange: (filters: InboxFilters) => void;
}): ConversationSearchController {
  const { filters, onFiltersChange } = args;
  const [state, dispatch] = useReducer(conversationSearchReducer, INITIAL_CONVERSATION_SEARCH);
  const inputRef = useRef<TextInput>(null);

  const normalizedQuery = normalizeSearchQuery(state.query);
  const filtersRef = useRef(args);
  filtersRef.current = args;

  // Deep search: match conversations by message body, merged into the live
  // filter so typing surfaces chats even when the term is buried in history.
  useEffect(() => {
    if (normalizedQuery.length < 2) return;
    const q = normalizedQuery;
    const handle = setTimeout(() => {
      dispatch({ type: "deep-pending", query: q });
      api
        .search(q)
        .then((messages) => {
          // The reducer drops results tagged with a query that is no longer
          // current, so a late landing can never pollute a newer view.
          dispatch({ type: "deep-ready", query: q, guids: new Set(messages.map((m) => m.chatGuid)) });
        })
        .catch(() => dispatch({ type: "deep-failed", query: q }));
    }, 250);
    return () => clearTimeout(handle);
  }, [normalizedQuery]);

  const deepMatches = usableDeepMatches(state);

  return useMemo<ConversationSearchController>(() => {
    const active = normalizedQuery.length > 0;
    return {
      query: state.query,
      normalizedQuery,
      active,
      deepSearch: state.deepSearch,
      deepMatches,
      viewKey: `${filters.state}|${filters.type}|${normalizedQuery}`,
      inputRef,
      setQuery(value) {
        dispatch({ type: "set-query", value });
        // Searching wipes the lenses — results span everything, and the
        // pills visibly reset to All to say so. Firing at most once: after
        // the wipe the filters ARE all/all, so later keystrokes no-op.
        const { filters: f, onFiltersChange: change } = filtersRef.current;
        if (normalizeSearchQuery(value).length > 0 && (f.state !== "all" || f.type !== "all")) {
          change({ state: "all", type: "all" });
        }
      },
      clear() {
        if (!active) return false;
        dispatch({ type: "clear" });
        return true;
      },
      applyFilters(next) {
        dispatch({ type: "clear" });
        filtersRef.current.onFiltersChange(next);
      },
    };
  }, [state, normalizedQuery, deepMatches, filters.state, filters.type]);
}
