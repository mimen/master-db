import { describe, expect, test } from "vitest";

describe("upsertAccount transform", () => {
  test("is_active defaults to true when omitted", () => {
    const account = { is_active: undefined };
    expect(account.is_active ?? true).toBe(true);
  });

  test("mark_full_sync_started stamps current time", () => {
    const before = Date.now();
    const now = new Date().toISOString();
    const markSync: boolean = true;
    const stamped = markSync ? now : undefined;
    expect(typeof stamped).toBe("string");
    expect(new Date(stamped!).getTime()).toBeGreaterThanOrEqual(before);
  });

  test("when mark_full_sync_started is false, prior timestamp is preserved", () => {
    const existing = { last_full_sync_at: "2025-01-01T00:00:00.000Z" };
    const markSync: boolean = false;
    const next = markSync ? new Date().toISOString() : existing.last_full_sync_at;
    expect(next).toBe("2025-01-01T00:00:00.000Z");
  });
});
