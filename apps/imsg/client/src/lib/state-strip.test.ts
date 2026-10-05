import { describe, expect, test } from "bun:test";
import type { ChatSummary } from "@shared/types";
import { firstName, relativeDay, stripCopy } from "./state-strip";

const H = 3_600_000;
// Saturday 2027-01-16 12:00 local.
const NOW = new Date(2027, 0, 16, 12).getTime();

function chat(flags: Partial<ChatSummary["flags"]>, last: { at: number; fromMe: boolean } | null, extra: Partial<ChatSummary> = {}): ChatSummary {
  return {
    guid: "c", displayName: "Tracy Mesina", isGroup: false, known: true, isSpam: false, participants: [], unreadCount: 0,
    lastMessage: last && { guid: "m", text: "", dateCreated: last.at, isFromMe: last.fromMe, senderName: null, hasAttachments: false },
    flags: { unresponded: false, waiting: false, unread: false, mutedUnresponded: false, pinned: false, ...flags },
    ...extra,
  };
}
const msg = (at: number, isFromMe: boolean, isGroupEvent = false) => ({ dateCreated: at, isFromMe, isGroupEvent });

describe("stripCopy", () => {
  test("your turn counts from the first message after your reply and names the reply day", () => {
    const friday = new Date(2027, 0, 15, 20).getTime();
    const copy = stripCopy({
      chat: chat({ unresponded: true }, { at: NOW - H, fromMe: false }),
      messages: [msg(friday - H, false), msg(friday, true), msg(NOW - 5 * H, false), msg(NOW - H, false)],
      historyComplete: false, now: NOW, compact: false,
    });
    expect(copy).toEqual({ tone: "turn", lead: "Your turn for 5h", detail: "You last replied yesterday", action: "settle" });
  });

  test("phone wording and a weekday older than yesterday", () => {
    const wed = new Date(2027, 0, 13, 9).getTime();
    const copy = stripCopy({
      chat: chat({ unresponded: true }, { at: NOW - 2 * H, fromMe: false }),
      messages: [msg(wed, true), msg(NOW - 2 * H, false)],
      historyComplete: false, now: NOW, compact: true,
    });
    expect(copy?.detail).toBe("Replied Wednesday");
  });

  test("never replied says so only when the whole history is loaded", () => {
    const input = { chat: chat({ unresponded: true }, { at: NOW - 40 * 60_000, fromMe: false }), messages: [msg(NOW - 40 * 60_000, false)], now: NOW, compact: false };
    expect(stripCopy({ ...input, historyComplete: true })?.detail).toBe("You haven't replied yet");
    expect(stripCopy({ ...input, historyComplete: false })?.detail).toBeNull();
    expect(stripCopy({ ...input, historyComplete: true })?.lead).toBe("Your turn for 40m");
  });

  test("group events never count as a reply or the start of a turn", () => {
    const copy = stripCopy({
      chat: chat({ unresponded: true }, { at: NOW - H, fromMe: false }),
      messages: [msg(NOW - 9 * H, true, true), msg(NOW - 3 * H, false)],
      historyComplete: true, now: NOW, compact: false,
    });
    expect(copy).toMatchObject({ lead: "Your turn for 3h", detail: "You haven't replied yet" });
  });

  test("waiting names whose move it is", () => {
    const copy = stripCopy({ chat: chat({ waiting: true }, { at: NOW - 2 * 24 * H, fromMe: true }), messages: [], historyComplete: false, now: NOW, compact: false });
    expect(copy).toMatchObject({ tone: "waiting", lead: "Waiting on Tracy 2d", detail: null });
  });

  test("settled offers un-settle and says what brings it back", () => {
    const copy = stripCopy({ chat: chat({}, { at: NOW - H, fromMe: false }), messages: [], historyComplete: false, now: NOW, compact: false });
    expect(copy).toEqual({ tone: "settled", lead: "Settled", detail: "Back in Needs reply if Tracy texts again", action: "unsettle" });
  });

  test("an empty conversation has no strip", () => {
    expect(stripCopy({ chat: chat({}, null), messages: [], historyComplete: true, now: NOW, compact: false })).toBeNull();
  });
});

test("first names: groups and bare numbers", () => {
  expect(firstName({ displayName: "Showcase crew", isGroup: true })).toBe("someone");
  expect(firstName({ displayName: "(619) 555-0101", isGroup: false })).toBe("(619) 555-0101");
});

test("relative days", () => {
  expect(relativeDay(NOW - H, NOW)).toBe("today");
  expect(relativeDay(new Date(2027, 0, 1).getTime(), NOW)).toBe("Jan 1");
});
