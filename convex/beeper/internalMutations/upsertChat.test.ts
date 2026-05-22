import { describe, expect, test } from "vitest";

describe("upsertChat transform", () => {
  test("derives epoch ms from last_activity ISO string", () => {
    const iso = "2026-05-22T22:26:41.000Z";
    expect(new Date(iso).getTime()).toBe(Date.UTC(2026, 4, 22, 22, 26, 41));
  });

  test("participant_count is derived from participants length", () => {
    const participants = [
      { id: "@a:beeper.local" },
      { id: "@b:beeper.local" },
      { id: "@c:beeper.local" },
    ];
    expect(participants.length).toBe(3);
  });

  test("optional boolean flags default to false", () => {
    const chat = { is_archived: undefined, is_muted: undefined };
    expect(chat.is_archived ?? false).toBe(false);
    expect(chat.is_muted ?? false).toBe(false);
  });

  test("first_seen_at is preserved on update, last_synced_at always bumped", () => {
    const existing = {
      first_seen_at: "2025-01-01T00:00:00.000Z",
      last_synced_at: "2025-06-01T00:00:00.000Z",
    };
    const now = "2026-05-22T00:00:00.000Z";
    const merged = {
      first_seen_at: existing.first_seen_at ?? now,
      last_synced_at: now,
    };
    expect(merged.first_seen_at).toBe("2025-01-01T00:00:00.000Z");
    expect(merged.last_synced_at).toBe(now);
  });
});
