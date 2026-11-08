import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { CommaReactionState } from "../schema/comma/validators";

import { currentKey, fromTapback, messageKey, reactionWrites, sameReaction, shownReactions, supersedes } from "./reactions";

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

  test("an emoji tapback is keyed emoji:<emoji>; an unreadable one by \"emoji\"", () => {
    expect(fromTapback({ ...row, tapback: { targetGuid: "m1", reaction: "emoji", emoji: "😍", remove: true } }))
      .toEqual(state({ key: "emoji:😍", emoji: "😍", removed: true }));
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

describe("shownReactions", () => {
  test("shows live rows oldest first in the read form and drops removals", () => {
    const rows = [state({ at: 30, key: "like", emoji: "👍" }), state({ at: 20, removed: true }), state({ at: 25, key: "laugh", emoji: "😂", isFromMe: true, senderAddress: undefined })];
    expect(shownReactions(rows)).toEqual([
      { key: "laugh", emoji: "😂", isFromMe: true, senderName: null, senderAddress: null, type: "laugh" },
      { key: "like", emoji: "👍", isFromMe: false, senderName: null, senderAddress: "+15550001111", type: "like" },
    ]);
  });
});

test("shownReactions shows each sender's newest live reaction, as rows written before one per sender can hold two", () => {
  const rows = [state({ at: 10 }), state({ at: 12, key: "emoji:😮", emoji: "😮" }), state({ at: 11, key: "like", isFromMe: true, senderAddress: undefined })];
  expect(shownReactions(rows).map((r) => [r.key, r.isFromMe])).toEqual([["like", true], ["emoji:😮", false]]);
});

describe("reactionWrites", () => {
  const fire = state({ key: "emoji:🔥", emoji: "🔥", at: 20 });

  test("a sender's add leaves their other live reaction as a tombstone at the add's time", () => {
    expect(reactionWrites([state()], fire)).toEqual([{ row: undefined, state: fire }, { row: state(), state: state({ at: 20, removed: true }) }]);
  });

  test("an add older than the sender's live reaction lands as a tombstone and leaves it", () => {
    expect(reactionWrites([fire], state())).toEqual([{ row: undefined, state: state({ removed: true }) }]);
  });

  test("a removal touches only its own key; other senders are never touched", () => {
    const peer = state({ senderAddress: "+15550002222" });
    expect(reactionWrites([state(), peer], fire)).toHaveLength(2);
    expect(reactionWrites([fire], state({ at: 30, removed: true }))).toEqual([{ row: undefined, state: state({ at: 30, removed: true }) }]);
    expect(reactionWrites([fire], fire)).toEqual([]);
  });
});

describe("a platform where a sender keeps several reactions", () => {
  const fire = state({ key: "emoji:🔥", emoji: "🔥", at: 20 });

  test("an add leaves the sender's other reactions live, and each key's removal touches only that key", () => {
    expect(reactionWrites([state()], fire, false)).toEqual([{ row: undefined, state: fire }]);
    expect(reactionWrites([state()], state({ key: "like", at: 5 }), false)).toEqual([{ row: undefined, state: state({ key: "like", at: 5 }) }]);
  });

  test("every live reaction shows, oldest first", () => {
    expect(shownReactions([fire, state(), state({ key: "like", removed: true })], false).map((r) => r.key)).toEqual(["love", "emoji:🔥"]);
  });

  test("iMessage keeps one per sender by its profile", () => {
    expect(reactionWrites([state()], fire)).toEqual(reactionWrites([state()], fire, true));
    expect(shownReactions([state(), fire]).map((r) => r.key)).toEqual(["emoji:🔥"]);
  });
});

test("currentKey namespaces an emoji key written bare and leaves every other key", () => {
  expect(["😍", "emoji:😍", "emoji", "love"].map(currentKey)).toEqual(["emoji:😍", "emoji:😍", "emoji", "love"]);
});
