import { describe, expect, test } from "bun:test";
import type { AgentChatSummary } from "./agent-api";
import { agentStripState } from "./agent-strip";

type Chat = NonNullable<Parameters<typeof agentStripState>[0]>;
const chat = (state: AgentChatSummary["state"], extra: Partial<Chat> = {}): Chat => ({ state, updatedAt: 10, ...extra });
const ended = { lastTurnEndedAt: 20 };

describe("state strip", () => {
  test("each attention that wants the user has its own line", () => {
    expect(agentStripState(chat("waiting_input"))).toBe("asking");
    expect(agentStripState(chat("running"))).toBe("working");
    expect(agentStripState(chat("pending"))).toBe("working");
    expect(agentStripState(chat("failed", ended))).toBe("failed");
    expect(agentStripState(chat("idle", { ...ended, preview: { kind: "reply", text: "Marcus plays 90 minutes" } }))).toBe("replied");
    expect(agentStripState(chat("idle", { ...ended, preview: { kind: "draft", text: "See you Friday" } }))).toBe("drafted");
  });

  test("a seen, settled or missing chat says nothing", () => {
    expect(agentStripState(chat("idle", { ...ended, seenAt: 30, preview: { kind: "draft", text: "See you Friday" } }))).toBeNull();
    expect(agentStripState(chat("failed", { ...ended, seenAt: 30 }))).toBeNull();
    expect(agentStripState(chat("waiting_input", { settledAt: 30 }))).toBeNull();
    expect(agentStripState(undefined)).toBeNull();
  });
});
