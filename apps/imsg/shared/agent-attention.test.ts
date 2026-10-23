import { describe, expect, test } from "bun:test";
import { agentAttention, mostUrgent, WANTS_YOU, type AttentionInput } from "./agent-attention";

const chat = (overrides: Partial<AttentionInput> & { id?: string } = {}): AttentionInput & { id: string } =>
  ({ id: "c", state: "idle", updatedAt: 1, ...overrides });

describe("agentAttention", () => {
  test("a settled chat is settled whatever its state", () => {
    for (const state of ["idle", "pending", "running", "waiting_input", "interrupted", "failed"] as const) {
      expect(agentAttention(chat({ state, settledAt: 5, lastTurnEndedAt: 9 }))).toBe("settled");
    }
  });

  test("an open question needs the user and a turn in flight is working", () => {
    expect(agentAttention(chat({ state: "waiting_input" }))).toBe("needs_you");
    expect(agentAttention(chat({ state: "pending" }))).toBe("working");
    expect(agentAttention(chat({ state: "running", lastTurnEndedAt: 9, seenAt: 1 }))).toBe("working");
  });

  test("a turn that ended after the last look is ready, or failed when it failed", () => {
    expect(agentAttention(chat({ state: "idle", lastTurnEndedAt: 9, seenAt: 5 }))).toBe("ready");
    expect(agentAttention(chat({ state: "idle", lastTurnEndedAt: 9 }))).toBe("ready");
    expect(agentAttention(chat({ state: "failed", lastTurnEndedAt: 9, seenAt: 5 }))).toBe("failed");
  });

  test("a seen turn, a never-finished chat and an interrupted one are just open", () => {
    expect(agentAttention(chat({ state: "idle", lastTurnEndedAt: 9, seenAt: 9 }))).toBe("open");
    expect(agentAttention(chat({ state: "failed", lastTurnEndedAt: 9, seenAt: 10 }))).toBe("open");
    expect(agentAttention(chat({ state: "idle" }))).toBe("open");
    expect(agentAttention(chat({ state: "interrupted", lastTurnEndedAt: 9 }))).toBe("open");
  });
});

describe("mostUrgent", () => {
  const needs = chat({ id: "needs", state: "waiting_input", updatedAt: 1 });
  const failed = chat({ id: "failed", state: "failed", lastTurnEndedAt: 2, updatedAt: 2 });
  const ready = chat({ id: "ready", state: "idle", lastTurnEndedAt: 3, updatedAt: 3 });
  const working = chat({ id: "working", state: "running", updatedAt: 4 });
  const open = chat({ id: "open", state: "idle", updatedAt: 5 });

  test("ranks needs you, failed, ready, working, open, with ready above working", () => {
    const ranked = [open, working, ready, failed, needs];
    const order: string[] = [];
    for (let rest = ranked; rest.length; rest = rest.filter((c) => c !== mostUrgent(rest))) order.push(mostUrgent(rest)!.id);
    expect(order).toEqual(["needs", "failed", "ready", "working", "open"]);
  });

  test("ties go to the most recent activity", () => {
    const older = chat({ id: "older", state: "running", updatedAt: 10 });
    const newer = chat({ id: "newer", state: "running", updatedAt: 20 });
    expect(mostUrgent([older, newer])?.id).toBe("newer");
    expect(mostUrgent([newer, older])?.id).toBe("newer");
  });

  test("ignores settled chats, and has nothing when every chat is settled", () => {
    const settledQuestion = chat({ id: "settled", state: "waiting_input", settledAt: 1, updatedAt: 99 });
    expect(mostUrgent([settledQuestion, open])?.id).toBe("open");
    expect(mostUrgent([settledQuestion])).toBeUndefined();
    expect(mostUrgent([])).toBeUndefined();
  });

  test("WANTS_YOU is the three attentions the Agents tab counts", () => {
    expect([...WANTS_YOU].sort()).toEqual(["failed", "needs_you", "ready"]);
  });
});
