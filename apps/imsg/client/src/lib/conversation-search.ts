/**
 * Pure state machine for Messages (inbox) search — the policy half of the
 * search feature, extracted so "what clears search" and "which deep results
 * count" are unit-testable without React. The side-effectful debounce/API
 * wiring lives in components/conversations/use-conversation-search.ts.
 *
 * Contacts search is deliberately NOT this: it has no lenses, no deep message
 * search, and its own Airtable lookup (see the architecture review).
 */

/** Async message-body search, tagged with the query that produced it so a
 * result set can never be attributed to a newer query. */
export type DeepSearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending"; readonly query: string }
  | { readonly kind: "ready"; readonly query: string; readonly guids: ReadonlySet<string> }
  | { readonly kind: "failed"; readonly query: string };

export interface ConversationSearchState {
  readonly query: string;
  readonly deepSearch: DeepSearchState;
}

export type ConversationSearchAction =
  | { readonly type: "set-query"; readonly value: string }
  | { readonly type: "clear" }
  | { readonly type: "deep-pending"; readonly query: string }
  | { readonly type: "deep-ready"; readonly query: string; readonly guids: ReadonlySet<string> }
  | { readonly type: "deep-failed"; readonly query: string };

export const INITIAL_CONVERSATION_SEARCH: ConversationSearchState = {
  query: "",
  deepSearch: { kind: "idle" },
};

/** The comparable form of a query — what deep results are tagged with. */
export function normalizeSearchQuery(query: string): string {
  return query.trim();
}

export function conversationSearchReducer(
  state: ConversationSearchState,
  action: ConversationSearchAction,
): ConversationSearchState {
  switch (action.type) {
    case "set-query": {
      const next = normalizeSearchQuery(action.value);
      const prev = normalizeSearchQuery(state.query);
      return {
        query: action.value,
        // Stale results must never survive a query change: matches for
        // "pizza" must not contribute under "zebra" while its request flies.
        deepSearch: next === prev ? state.deepSearch : { kind: "idle" },
      };
    }
    case "clear":
      return INITIAL_CONVERSATION_SEARCH;
    case "deep-pending":
      return action.query === normalizeSearchQuery(state.query)
        ? { ...state, deepSearch: { kind: "pending", query: action.query } }
        : state;
    case "deep-ready":
      // A late response for an old query is dropped, not applied.
      return action.query === normalizeSearchQuery(state.query)
        ? { ...state, deepSearch: { kind: "ready", query: action.query, guids: action.guids } }
        : state;
    case "deep-failed":
      return action.query === normalizeSearchQuery(state.query)
        ? { ...state, deepSearch: { kind: "failed", query: action.query } }
        : state;
  }
}

const EMPTY_GUIDS: ReadonlySet<string> = new Set();

/** Deep-match GUIDs that are valid for the CURRENT query — empty otherwise. */
export function usableDeepMatches(state: ConversationSearchState): ReadonlySet<string> {
  return state.deepSearch.kind === "ready" &&
    state.deepSearch.query === normalizeSearchQuery(state.query)
    ? state.deepSearch.guids
    : EMPTY_GUIDS;
}
