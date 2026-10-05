import { expect, test } from "bun:test";
import type { ChatSummary } from "@shared/types";
import { commandQuery, peopleFirstSections, turnAge } from "./palette-people";

const NOW = 1_800_000_000_000;
const H = 3_600_000;

function chat(guid: string, unresponded: boolean, lastAt: number): ChatSummary {
  return {
    guid, displayName: guid, isGroup: false, known: true, isSpam: false, participants: [], unreadCount: 0, firstUnreadAt: null,
    lastMessage: { guid: `${guid}-m`, text: "", dateCreated: lastAt, isFromMe: false, senderName: null, hasAttachments: false },
    flags: { unresponded, waiting: !unresponded, unread: false, mutedUnresponded: false, pinned: false },
  };
}

test("empty query lists the four longest your-turn conversations, then three recent ones not already shown", () => {
  // Recency order, as the palette receives it.
  const chats = [
    chat("r1", false, NOW - H),
    chat("t1", true, NOW - 2 * H),
    chat("r2", false, NOW - 3 * H),
    chat("t2", true, NOW - 30 * H),
    chat("t3", true, NOW - 60 * H),
    chat("r3", false, NOW - 70 * H),
    chat("t4", true, NOW - 100 * H),
    chat("t5", true, NOW - 400 * H),
    chat("r4", false, NOW - 500 * H),
  ];
  const { sections, ages } = peopleFirstSections(chats, NOW);
  expect(sections.map((s) => [s.title, s.items.map((i) => i.key)])).toEqual([
    ["Your turn the longest", ["chat-t5", "chat-t4", "chat-t3", "chat-t2"]],
    ["Recent", ["chat-r1", "chat-t1", "chat-r2"]],
  ]);
  expect(ages.get("chat-t5")).toEqual({ text: "Your turn 2w", late: true });
  expect(ages.get("chat-t2")).toEqual({ text: "Your turn 1d", late: false });
  expect(ages.get("chat-r1")).toEqual({ text: "1h", late: false });
});

test("no commands and no empty sections when nothing is your turn", () => {
  const { sections } = peopleFirstSections([chat("a", false, NOW - H)], NOW);
  expect(sections.map((s) => s.title)).toEqual(["Recent"]);
});

test("turn age is only for conversations waiting on the owner", () => {
  expect(turnAge(chat("a", false, NOW - H), NOW)).toBeNull();
  expect(turnAge(chat("b", true, NOW - 5 * H), NOW)).toEqual({ text: "Your turn 5h", late: false });
});

test("a leading > switches to commands and passes the rest through as the filter", () => {
  expect(commandQuery(">")).toBe("");
  expect(commandQuery("  >sett")).toBe("sett");
  expect(commandQuery("sett")).toBeNull();
});
