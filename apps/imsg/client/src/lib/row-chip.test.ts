import { describe, expect, test } from "bun:test";
import type { ChatSummary } from "@shared/types";
import { rowChip } from "./row-chip";

const now = new Date(2026, 10, 9, 14, 0, 0);
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0, 0).getTime();
const agent = (attention: NonNullable<ChatSummary["agent"]>["attention"]): ChatSummary["agent"] =>
  ({ attention, chatId: "c1", title: "Ask", openCount: 1, activityAt: 0 }) as unknown as ChatSummary["agent"];

describe("rowChip", () => {
  test("the agent's state wins, tinted by what it wants", () => {
    expect(rowChip({ agent: agent("needs_you"), later: { snoozedUntil: at(10, 9) } }, { now })).toEqual({ label: "Agent: needs you", tone: "turn", icon: "sparkles" });
    expect(rowChip({ agent: agent("failed") }, { now })?.tone).toBe("destructive");
    expect(rowChip({ agent: agent("ready") }, { now })?.tone).toBe("accent");
    expect(rowChip({ agent: agent("working") }, { now })?.tone).toBe("neutral");
  });

  test("an open agent chat and the Agents lens add no chip", () => {
    expect(rowChip({ agent: agent("open") }, { now })).toBeNull();
    expect(rowChip({ agent: agent("needs_you") }, { now, agentLens: true })).toBeNull();
  });

  test("Later reads as one neutral chip: back, follow-up due, or snoozed", () => {
    expect(rowChip({ later: { returned: { reason: "message", until: at(9, 9), at: at(9, 10) } } }, { now })?.label).toBe("Back: new reply");
    expect(rowChip({ later: { returned: { reason: "time", until: at(9, 9), at: at(9, 9) } } }, { now })?.label).toBe("Back from Later");
    expect(rowChip({ later: { followUp: { at: at(9, 9), since: at(3, 12), due: true } } }, { now })).toEqual({ label: "No reply since Nov 3", tone: "neutral", icon: "alarm-outline" });
    expect(rowChip({ later: { snoozedUntil: at(10, 9) } }, { now })?.label).toMatch(/^Snoozed until Tomorrow, 9:00/);
  });

  test("a follow-up still pending, or no deferral at all, adds nothing", () => {
    expect(rowChip({ later: { followUp: { at: at(11, 9), since: at(8, 12), due: false } } }, { now })).toBeNull();
    expect(rowChip({}, { now })).toBeNull();
  });
});
