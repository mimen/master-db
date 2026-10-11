import { describe, expect, test } from "bun:test";

import { computeCounts } from "@shared/chat-state";
import type { ChatSummary } from "@shared/types";

import { applyFlagIntents, retireFlagIntents, type FlagIntent, type PendingFlags } from "./pending-flags";

const inbound = { guid: "m2", text: "when?", dateCreated: 200, isFromMe: false, senderName: null, hasAttachments: false };

function chat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    guid: "c1", displayName: "Alex", isGroup: false, known: true, isSpam: false, participants: [],
    lastMessage: inbound, unreadCount: 2, firstUnreadAt: 150,
    flags: { unresponded: true, waiting: false, unread: true, mutedUnresponded: false, pinned: false },
    ...overrides,
  };
}

const pending = (...intents: [FlagIntent, boolean?][]): PendingFlags =>
  new Map(intents.map(([intent, confirmed = false], index) => [String(index), { intent, confirmed }]));

describe("applyFlagIntents", () => {
  test("a settle leaves Needs reply and joins Settled in the counts on the same pass", () => {
    const before = [chat(), chat({ guid: "c2" })];
    const after = applyFlagIntents(before, pending([{ change: "settle", chatGuid: "c1", seen: "m2" }]));
    expect(computeCounts(before, "all")).toMatchObject({ unresponded: 2, settled: 0 });
    expect(computeCounts(after, "all")).toMatchObject({ unresponded: 1, settled: 1 });
    expect(after[1]).toBe(before[1]);
  });

  test("a settle of a message the user never saw changes nothing", () => {
    const newer = chat({ lastMessage: { ...inbound, guid: "m3", dateCreated: 300 } });
    const [shown] = applyFlagIntents([newer], pending([{ change: "settle", chatGuid: "c1", seen: "m2" }]));
    expect(shown).toBe(newer);
  });

  test("a settle right after a send holds once the mirror replaces the temp guid, and yields to their reply", () => {
    const settle = pending([{ change: "settle", chatGuid: "c1", seen: undefined }]);
    const mine = chat({ lastMessage: { ...inbound, guid: "real-1", isFromMe: true }, flags: { ...chat().flags, unresponded: false, waiting: true } });
    expect(applyFlagIntents([mine], settle)[0]?.flags).toMatchObject({ waiting: false, unresponded: false });
    expect(applyFlagIntents([chat()], settle)[0]?.flags.unresponded).toBe(true);
  });

  test("un-settle returns the conversation to the queue its last message implies", () => {
    const outbound = { ...inbound, isFromMe: true };
    const settled = chat({ lastMessage: outbound, unreadCount: 0, flags: { ...chat().flags, unresponded: false, waiting: false, unread: false } });
    const [shown] = applyFlagIntents([settled], pending([{ change: "unsettle", chatGuid: "c1" }]));
    expect(shown?.flags).toMatchObject({ unresponded: false, waiting: true });
  });

  test("mark read clears the dot and the count; mark unread sets the flag without a count", () => {
    const [read] = applyFlagIntents([chat()], pending([{ change: "read", chatGuid: "c1", at: 250 }]));
    expect(read).toMatchObject({ unreadCount: 0, flags: { unread: false } });
    const quiet = chat({ unreadCount: 0, flags: { ...chat().flags, unread: false } });
    const [unread] = applyFlagIntents([quiet], pending([{ change: "unread", chatGuid: "c1" }]));
    expect(unread).toMatchObject({ unreadCount: 0, flags: { unread: true } });
  });

  test("a read from before a newer message leaves that message unread", () => {
    const [shown] = applyFlagIntents([chat()], pending([{ change: "read", chatGuid: "c1", at: 199 }]));
    expect(shown).toMatchObject({ unreadCount: 2, flags: { unread: true } });
  });

  test("a read of a conversation with nothing unread hands back the same directory, so nothing re-renders", () => {
    const quiet = [chat({ unreadCount: 0, flags: { ...chat().flags, unread: false } })];
    expect(applyFlagIntents(quiet, pending([{ change: "read", chatGuid: "c1", at: 250 }]))).toBe(quiet);
  });

  test("a rename shows the new name on the row and leaves its flags", () => {
    const [shown] = applyFlagIntents([chat()], pending([{ change: "rename", chatGuid: "c1", name: "Crew" }]));
    expect(shown).toMatchObject({ displayName: "Crew", flags: chat().flags, unreadCount: 2 });
  });

  test("intents on separate axes compose on one row", () => {
    const [shown] = applyFlagIntents([chat()], pending(
      [{ change: "pin", chatGuid: "c1", value: true }],
      [{ change: "settle", chatGuid: "c1", seen: "m2" }],
    ));
    expect(shown?.flags).toMatchObject({ pinned: true, unresponded: false, unread: true });
  });
});

describe("retireFlagIntents", () => {
  const pin: FlagIntent = { change: "pin", chatGuid: "c1", value: true };
  const pinned = chat({ flags: { ...chat().flags, pinned: true } });

  test("keeps an intent the bridge has not confirmed, even when the directory already agrees", () => {
    const intents = pending([pin, false]);
    expect(retireFlagIntents(intents, [pinned])).toBe(intents);
  });

  test("drops a confirmed intent once the directory shows it, and keeps one it does not show yet", () => {
    expect(retireFlagIntents(pending([pin, true]), [pinned]).size).toBe(0);
    const intents = pending([pin, true]);
    expect(retireFlagIntents(intents, [chat()])).toBe(intents);
  });

  test("keeps a confirmed rename until the directory carries the new name", () => {
    const rename = pending([{ change: "rename", chatGuid: "c1", name: "Crew" }, true]);
    expect(retireFlagIntents(rename, [chat()])).toBe(rename);
    expect(retireFlagIntents(rename, [chat({ displayName: "Crew" })]).size).toBe(0);
  });

  test("drops a confirmed settle that a newer message made moot", () => {
    const newer = chat({ lastMessage: { ...inbound, guid: "m3", dateCreated: 300 } });
    expect(retireFlagIntents(pending([{ change: "settle", chatGuid: "c1", seen: "m2" }, true]), [newer]).size).toBe(0);
  });
});
