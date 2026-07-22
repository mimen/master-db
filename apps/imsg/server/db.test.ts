import { beforeEach, describe, expect, test } from "bun:test";
import { OverlayDb } from "./db";

// bun:sqlite supports ":memory:", which keeps these cases isolated and fast.
let db: OverlayDb;

beforeEach(() => {
  db = new OverlayDb(":memory:");
});

describe("ai_meta", () => {
  test("returns null for an unset key", () => {
    expect(db.getAiMeta("anchor")).toBeNull();
  });

  test("round-trips a value", () => {
    db.setAiMeta("anchor", "uuid-1");
    expect(db.getAiMeta("anchor")).toBe("uuid-1");
  });

  test("upserts rather than duplicating", () => {
    db.setAiMeta("anchor", "uuid-1");
    db.setAiMeta("anchor", "uuid-2");
    expect(db.getAiMeta("anchor")).toBe("uuid-2");
  });
});

describe("shadow_message", () => {
  test("starts empty", () => {
    expect(db.listShadowMessages("chat-1")).toEqual([]);
  });

  test("returns messages in insertion order", () => {
    db.addShadowMessage("s1", "chat-1", "user", "who is this");
    db.addShadowMessage("s2", "chat-1", "assistant", "probably Sarah");
    const rows = db.listShadowMessages("chat-1");
    expect(rows.map((r) => r.text)).toEqual(["who is this", "probably Sarah"]);
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
  });

  test("keeps chats isolated", () => {
    db.addShadowMessage("s1", "chat-1", "user", "a");
    db.addShadowMessage("s2", "chat-2", "user", "b");
    expect(db.listShadowMessages("chat-1")).toHaveLength(1);
    expect(db.listShadowMessages("chat-2")).toHaveLength(1);
  });

  test("orders same-millisecond inserts by rowid, not just timestamp", () => {
    // Rapid turns can share a Date.now(); insertion order must still hold.
    for (let i = 0; i < 5; i++) db.addShadowMessage(`s${i}`, "chat-1", "user", `m${i}`);
    expect(db.listShadowMessages("chat-1").map((r) => r.text)).toEqual([
      "m0",
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
  });

  test("clear removes only the target chat", () => {
    db.addShadowMessage("s1", "chat-1", "user", "a");
    db.addShadowMessage("s2", "chat-2", "user", "b");
    db.clearShadowMessages("chat-1");
    expect(db.listShadowMessages("chat-1")).toEqual([]);
    expect(db.listShadowMessages("chat-2")).toHaveLength(1);
  });

  test("returns the inserted row", () => {
    const row = db.addShadowMessage("s1", "chat-1", "user", "hi");
    expect(row.id).toBe("s1");
    expect(row.role).toBe("user");
    expect(row.created_at).toBeGreaterThan(0);
  });
});

describe("suggestion_cache", () => {
  test("returns null when absent", () => {
    expect(db.getSuggestionCache("chat-1")).toBeNull();
  });

  test("round-trips a payload with its anchor guid", () => {
    db.setSuggestionCache("chat-1", "msg-9", '["a","b"]');
    const row = db.getSuggestionCache("chat-1");
    expect(row?.payload).toBe('["a","b"]');
    expect(row?.last_message_guid).toBe("msg-9");
  });

  test("upserts on repeat generation", () => {
    db.setSuggestionCache("chat-1", "msg-9", '["old"]');
    db.setSuggestionCache("chat-1", "msg-10", '["new"]');
    expect(db.getSuggestionCache("chat-1")?.payload).toBe('["new"]');
    expect(db.getSuggestionCache("chat-1")?.last_message_guid).toBe("msg-10");
  });

  test("tolerates a null last-message guid for an empty chat", () => {
    db.setSuggestionCache("chat-1", null, "[]");
    expect(db.getSuggestionCache("chat-1")?.last_message_guid).toBeNull();
  });
});
