import { expect, test } from "bun:test";
import type { AgentChatId, AgentChatSummary } from "./agent-api";
import { switcherRows } from "./agent-chats";

const NOW = new Date(2026, 9, 23, 15, 0).getTime();
let serial = 0;
function chat(title: string, state: AgentChatSummary["state"], extra: Partial<AgentChatSummary> = {}): AgentChatSummary {
  serial += 1;
  return {
    _id: `chat-${serial}` as AgentChatId, conversationId: "conv" as AgentChatSummary["conversationId"], title, state,
    model: "claude-opus-5-5", effort: "high", createdAt: NOW - 3_600_000, updatedAt: NOW - 60_000, ...extra,
  };
}

test("open chats come first under the person's name with their state, then settled ones by date, then New chat", () => {
  const settled = chat("Flyer feedback", "idle", { settledAt: new Date(2026, 9, 9, 12).getTime(), lastTurnEndedAt: 1 });
  const working = chat("Venues", "running", { updatedAt: NOW - 18_000 });
  const rows = switcherRows([
    settled,
    working,
    chat("Guest list", "waiting_input"),
    chat("Rideshare codes", "idle", { lastTurnEndedAt: NOW - 1_000, preview: { kind: "draft", text: "Here you go" } }),
    chat("Hotel block", "idle", { lastTurnEndedAt: NOW - 1_000, seenAt: NOW }),
    chat("Deposit", "failed", { lastTurnEndedAt: NOW - 1_000 }),
  ], "Leah Kim", { kind: "chat", chatId: working._id }, NOW);
  expect(rows.map(({ label, trailing, section }) => [label, trailing, section])).toEqual([
    ["Venues", "18s", "Leah Kim"],
    ["Guest list", "Needs you", "Leah Kim"],
    ["Rideshare codes", "Draft ready", "Leah Kim"],
    ["Hotel block", "Open", "Leah Kim"],
    ["Deposit", "Failed", "Leah Kim"],
    ["Flyer feedback", "Oct 9", "Settled"],
    ["New chat", undefined, ""],
  ]);
  expect(rows.at(-1)?.value).toBe("new");
});

test("a chat the pane just created stands in until the list carries it", () => {
  const rows = switcherRows([], "Alex Rivera", { kind: "chat", chatId: "chat-new" as AgentChatId }, NOW);
  expect(rows.map(({ value, label }) => [value, label])).toEqual([["chat-new", "New chat"], ["new", "New chat"]]);
  expect(switcherRows([], "Alex Rivera", { kind: "new" }, NOW).map(({ value }) => value)).toEqual(["new"]);
});
