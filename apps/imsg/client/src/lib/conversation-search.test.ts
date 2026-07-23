import { describe, expect, test } from "bun:test";

import {
  conversationSearchReducer,
  INITIAL_CONVERSATION_SEARCH,
  usableDeepMatches,
  type ConversationSearchState,
} from "./conversation-search";

const ready = (query: string, guids: string[]): ConversationSearchState => ({
  query,
  deepSearch: { kind: "ready", query, guids: new Set(guids) },
});

describe("conversationSearchReducer", () => {
  test("changing the normalized query clears deep matches immediately", () => {
    const next = conversationSearchReducer(ready("pizza", ["a"]), {
      type: "set-query",
      value: "zebra",
    });

    expect(next.query).toBe("zebra");
    expect(next.deepSearch).toEqual({ kind: "idle" });
    expect(usableDeepMatches(next).size).toBe(0);
  });

  test("whitespace-only edits keep the current deep matches", () => {
    const next = conversationSearchReducer(ready("pizza", ["a"]), {
      type: "set-query",
      value: "pizza ",
    });

    expect(usableDeepMatches(next)).toEqual(new Set(["a"]));
  });

  test("a late response for an old query is dropped", () => {
    const typing = conversationSearchReducer(INITIAL_CONVERSATION_SEARCH, {
      type: "set-query",
      value: "zebra",
    });
    const stale = conversationSearchReducer(typing, {
      type: "deep-ready",
      query: "pizza",
      guids: new Set(["a"]),
    });

    expect(stale.deepSearch).toEqual({ kind: "idle" });
    expect(usableDeepMatches(stale).size).toBe(0);
  });

  test("a response for the current query becomes usable", () => {
    const typing = conversationSearchReducer(INITIAL_CONVERSATION_SEARCH, {
      type: "set-query",
      value: " zebra ",
    });
    const landed = conversationSearchReducer(typing, {
      type: "deep-ready",
      query: "zebra",
      guids: new Set(["z1", "z2"]),
    });

    expect(usableDeepMatches(landed)).toEqual(new Set(["z1", "z2"]));
  });

  test("clear resets everything", () => {
    const next = conversationSearchReducer(ready("pizza", ["a"]), { type: "clear" });

    expect(next).toEqual(INITIAL_CONVERSATION_SEARCH);
  });

  test("pending and failed states are never usable", () => {
    const pending = conversationSearchReducer(
      conversationSearchReducer(INITIAL_CONVERSATION_SEARCH, { type: "set-query", value: "q1" }),
      { type: "deep-pending", query: "q1" },
    );
    const failed = conversationSearchReducer(pending, { type: "deep-failed", query: "q1" });

    expect(usableDeepMatches(pending).size).toBe(0);
    expect(usableDeepMatches(failed).size).toBe(0);
    expect(failed.deepSearch).toEqual({ kind: "failed", query: "q1" });
  });
});
