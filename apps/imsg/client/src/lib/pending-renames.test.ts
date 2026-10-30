import { describe, expect, test } from "bun:test";

import type { ChatSummary } from "@shared/types";

import { applyRenames, retireRenames, type PendingRenames } from "./pending-renames";

function chat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    guid: "c1", displayName: "Alex", isGroup: true, known: true, isSpam: false, participants: [],
    lastMessage: null, unreadCount: 0, firstUnreadAt: null,
    flags: { unresponded: false, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
    ...overrides,
  };
}

const pending = (name: string, confirmed = false): PendingRenames => new Map([["c1", { name, confirmed }]]);

describe("applyRenames", () => {
  test("a rename shows the new name on its row and leaves every other row as it was", () => {
    const rows = [chat(), chat({ guid: "c2" })];
    const shown = applyRenames(rows, pending("Crew"));
    expect(shown[0]).toEqual({ ...rows[0], displayName: "Crew" });
    expect(shown[1]).toBe(rows[1]);
  });

  test("returns the directory itself when nothing changes", () => {
    const rows = [chat({ displayName: "Crew" })];
    expect(applyRenames(rows, pending("Crew"))).toBe(rows);
  });
});

describe("retireRenames", () => {
  test("keeps a confirmed rename until the directory carries the new name", () => {
    const rename = pending("Crew", true);
    expect(retireRenames(rename, [chat()])).toBe(rename);
    expect(retireRenames(rename, [chat({ displayName: "Crew" })]).size).toBe(0);
  });

  test("never retires a rename the Mini has not confirmed", () => {
    const rename = pending("Crew");
    expect(retireRenames(rename, [chat({ displayName: "Crew" })])).toBe(rename);
  });
});
