import { describe, expect, test } from "bun:test";
import { filterForwardTargets } from "./forward-targets";
import type { ChatSummary } from "@shared/types";

function chat(guid: string, displayName: string): ChatSummary {
  return {
    guid,
    displayName,
    isGroup: false,
    participants: [],
  } as unknown as ChatSummary;
}

describe("filterForwardTargets", () => {
  test("empty query returns all chats", () => {
    const chats = [chat("a", "Alex"), chat("b", "Bea")];
    expect(filterForwardTargets(chats, "")).toEqual(chats);
  });

  test("whitespace-only query is treated as empty", () => {
    const chats = [chat("a", "Alex")];
    expect(filterForwardTargets(chats, "   ")).toEqual(chats);
  });

  test("filters case-insensitively by substring", () => {
    const chats = [chat("a", "Alex"), chat("b", "Bea"), chat("c", "alexandra")];
    expect(filterForwardTargets(chats, "ALEX").map((c) => c.guid)).toEqual(["a", "c"]);
  });

  test("caps results at 40", () => {
    const chats = Array.from({ length: 60 }, (_, i) => chat(`g${i}`, `Chat ${i}`));
    expect(filterForwardTargets(chats, "")).toHaveLength(40);
  });

  test("cap applies after filtering", () => {
    const matching = Array.from({ length: 50 }, (_, i) => chat(`m${i}`, `Match ${i}`));
    const chats = [...matching, chat("x", "Nope")];
    const result = filterForwardTargets(chats, "match");
    expect(result).toHaveLength(40);
    expect(result.every((c) => c.displayName.startsWith("Match"))).toBe(true);
  });
});
