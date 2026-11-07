import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { CommaReactionState } from "../schema/comma/validators";

import { fromTapback, mergeReactions, messageKey, sameReaction, supersedes } from "./reactions";

const conversationId = "c1" as Id<"comma_conversations">;
const state = (overrides: Partial<CommaReactionState> = {}): CommaReactionState => ({
  platform: "imessage", conversationId, targetKey: "imessage:m1", key: "love", emoji: "❤️",
  isFromMe: false, senderAddress: "+15550001111", at: 10, removed: false, ...overrides,
});

describe("messageKey", () => {
  test("namespaces a message id by its platform", () => {
    expect(messageKey("imessage", "ABC-1")).toBe("imessage:ABC-1");
  });
});

describe("fromTapback", () => {
  const row = { conversationId, isFromMe: false, sender: { address: "+15550001111" }, dateCreated: 10 };

  test("a classic tapback is keyed by its name and looks like its emoji", () => {
    expect(fromTapback({ ...row, tapback: { targetGuid: "m1", reaction: "like", remove: false } }))
      .toEqual(state({ key: "like", emoji: "👍" }));
  });

  test("an emoji tapback is keyed by its emoji; an unreadable one by \"emoji\"", () => {
    expect(fromTapback({ ...row, tapback: { targetGuid: "m1", reaction: "emoji", emoji: "😍", remove: true } }))
      .toEqual(state({ key: "😍", emoji: "😍", removed: true }));
    const { emoji: _emoji, ...unread } = state({ key: "emoji" });
    expect(fromTapback({ ...row, tapback: { targetGuid: "m1", reaction: "emoji", remove: false } })).toEqual(unread);
  });

  test("my own tapback carries no sender address; a row without a tapback is not a reaction", () => {
    const { senderAddress: _address, ...mine } = state({ isFromMe: true });
    expect(fromTapback({ ...row, isFromMe: true, tapback: { targetGuid: "m1", reaction: "love", remove: false } })).toEqual(mine);
    expect(fromTapback(row)).toBeNull();
  });
});

describe("sameReaction and supersedes", () => {
  test("my reactions share one sender whatever the address; other senders match by address", () => {
    expect(sameReaction({ key: "love", isFromMe: true, senderAddress: "a" }, { key: "love", isFromMe: true })).toBe(true);
    expect(sameReaction(state(), state({ senderAddress: "+15550002222" }))).toBe(false);
    expect(sameReaction(state(), state({ key: "like" }))).toBe(false);
  });

  test("an older event never replaces a newer state, and an identical one changes nothing", () => {
    expect(supersedes(state({ at: 5, removed: true }), state())).toBe(false);
    expect(supersedes(state(), state())).toBe(false);
    expect(supersedes(state({ at: 11, removed: true }), state())).toBe(true);
    expect(supersedes(state(), undefined)).toBe(true);
  });
});

describe("mergeReactions", () => {
  const legacyLove = { type: "love", isFromMe: false, senderName: "Alex", senderAddress: "+15550001111" };

  test("a legacy fold shows in the new form while no row has decided it", () => {
    expect(mergeReactions([legacyLove, { type: "emoji", emoji: "🔥", isFromMe: true, senderName: null, senderAddress: "me" }], [])).toEqual([
      { key: "love", emoji: "❤️", isFromMe: false, senderName: null, senderAddress: "+15550001111", type: "love" },
      { key: "🔥", emoji: "🔥", isFromMe: true, senderName: null, senderAddress: null, type: "emoji" },
    ]);
  });

  test("a row replaces the legacy entry for its sender and key, removed or not; live rows follow oldest first", () => {
    const rows = [state({ at: 30, key: "like", emoji: "👍" }), state({ at: 20, removed: true }), state({ at: 25, key: "laugh", emoji: "😂", isFromMe: true, senderAddress: undefined })];
    expect(mergeReactions([legacyLove], rows).map((r) => [r.key, r.isFromMe])).toEqual([["laugh", true], ["like", false]]);
  });
});
