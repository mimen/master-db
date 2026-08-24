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

describe("suggestion cache and feedback", () => {
  const cache = (anchor: string, payload: string) => ({
    chat_guid: "chat-1",
    selected_model: "opus",
    anchor_guid: anchor,
    recipe_version: 3,
    voice_revision: 1,
    edit_revision: 2,
    payload,
  });

  test("keys cache rows by chat and selected model", () => {
    expect(db.getSuggestionCache("chat-1", "opus")).toBeNull();
    db.setSuggestionCache(cache("msg-9", '{"a":1}'));
    db.setSuggestionCache({ ...cache("msg-10", '{"a":2}'), selected_model: "terra" });
    expect(db.getSuggestionCache("chat-1", "opus")?.anchor_guid).toBe("msg-9");
    expect(db.getSuggestionCache("chat-1", "terra")?.anchor_guid).toBe("msg-10");
  });

  test("prunes expired raw feedback immediately", () => {
    db.addSuggestionFeedback({
      id: "expired", chat_guid: "chat-1", suggestion_id: "s0", kind: "text",
      strategy: "clarify", vibe: "curious", selected_model: "opus", served_model: "opus",
      recipe_version: 3, suggested_text: "old", final_text: "old", selected_at: 0, sent_at: 0,
    });
    expect(db.listSuggestionFeedback()).toEqual([]);
  });

  test("stores feedback and deletes it with the chat", () => {
    db.addSuggestionFeedback({
      id: "f1", chat_guid: "chat-1", suggestion_id: "s1", kind: "text",
      strategy: "clarify", vibe: "curious", selected_model: "opus", served_model: "terra",
      recipe_version: 3, suggested_text: "what time?", final_text: "what time works?",
      selected_at: 10, sent_at: Date.now(),
    });
    expect(db.listSuggestionFeedback()).toHaveLength(1);
    db.deleteSuggestionFeedbackForChat("chat-1");
    expect(db.listSuggestionFeedback()).toEqual([]);
    expect(db.getSuggestionCache("chat-1", "opus")).toBeNull();
  });
});


describe("attachment_transcript", () => {
  test("caches transcripts by attachment GUID", () => {
    expect(db.getAttachmentTranscript("a1")).toBeNull();
    db.setAttachmentTranscript("a1", "hello from the voice note");
    db.setAttachmentTranscript("a2", "another note");
    expect(db.getAttachmentTranscript("a1")).toBe("hello from the voice note");
    expect(db.getAttachmentTranscript("a2")).toBe("another note");
  });

  test("updates an existing attachment cache entry", () => {
    db.setAttachmentTranscript("a1", "first");
    db.setAttachmentTranscript("a1", "corrected");
    expect(db.getAttachmentTranscript("a1")).toBe("corrected");
  });
});

describe("triage overlay", () => {
  test("stores Later with its anchor and clears expired rows", () => {
    db.setLater("chat-1", 2_000, "m1");
    expect(db.getAll().get("chat-1")?.laterUntil).toBe(2_000);
    expect(db.getAll().get("chat-1")?.laterAnchorGuid).toBe("m1");
    expect(db.clearExpiredLater(1_999)).toEqual([]);
    expect(db.clearExpiredLater(2_000)).toEqual(["chat-1"]);
    expect(db.getAll().get("chat-1")?.laterUntil).toBeNull();
  });

  test("deduplicates clear events by chat and message", () => {
    expect(db.recordTriageClear("chat-1", "m1", "dismiss", 10_000)).toBe(true);
    expect(db.recordTriageClear("chat-1", "m1", "reply", 11_000)).toBe(false);
    expect(db.recordTriageClear("chat-1", "m2", "reply", 12_000)).toBe(true);
    expect(db.countTriageClearsSince(10_500)).toBe(1);
  });

  test("round-trips smart closer and shadow brief caches", () => {
    db.setSmartCloserCache("chat-1", "in-1", '{"kind":"done","label":"Done"}');
    expect(db.getSmartCloserCache("chat-1")?.inbound_message_guid).toBe("in-1");
    db.setShadowBriefCache("chat-1", "m9", '{"context":"x","actionItems":[],"draft":""}');
    expect(db.getShadowBriefCache("chat-1")?.message_guid).toBe("m9");
  });
});
