import { expect, test } from "bun:test";
import type { ChatSummary } from "@shared/types";
import { compactAge, waitingLongest, yourTurnLongest } from "./turn-age";

const NOW = 1_800_000_000_000;
const H = 3_600_000;

function chat(guid: string, flags: Partial<ChatSummary["flags"]>, lastAt: number, firstUnreadAt: number | null = null): ChatSummary {
  return {
    guid, displayName: guid, isGroup: false, known: true, isSpam: false, participants: [], unreadCount: 0, firstUnreadAt,
    lastMessage: { guid: `${guid}-m`, text: "", dateCreated: lastAt, isFromMe: false, senderName: null, hasAttachments: false },
    flags: { unresponded: false, waiting: false, unread: false, mutedUnresponded: false, pinned: false, ...flags },
  };
}

test("compact ages step from minutes to weeks", () => {
  expect([0, 5 * 60_000, 5 * H, 6 * 24 * H, 15 * 24 * H].map(compactAge)).toEqual(["1m", "5m", "5h", "6d", "2w"]);
});

test("your turn the longest ranks Needs reply by the oldest unread, oldest first", () => {
  const chats = [
    chat("recent", { unresponded: true }, NOW - H),
    chat("old-unread", { unresponded: true }, NOW - H, NOW - 50 * H),
    chat("waiting", { waiting: true }, NOW - 99 * H),
    chat("mid", { unresponded: true }, NOW - 10 * H),
  ];
  expect(yourTurnLongest(chats, 2, NOW).map((a) => [a.chat.guid, a.ageMs])).toEqual([["old-unread", 50 * H], ["mid", 10 * H]]);
});

test("waiting on them the longest only ranks Waiting conversations", () => {
  const chats = [chat("a", { waiting: true }, NOW - 2 * H), chat("b", { unresponded: true }, NOW - 9 * H), chat("c", { waiting: true }, NOW - 7 * H)];
  expect(waitingLongest(chats, 3, NOW).map((a) => a.chat.guid)).toEqual(["c", "a"]);
});
