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
    db.setAiMeta("suggestion_route_cooldowns_v1", "a");
    db.setAiMeta("suggestion_route_cooldowns_v1", "b");
    expect(db.getAiMeta("suggestion_route_cooldowns_v1")).toBe("b");
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
  test("deduplicates clear events by chat and message", () => {
    expect(db.recordTriageClear("chat-1", "m1", "dismiss", 10_000)).toBe(true);
    expect(db.recordTriageClear("chat-1", "m1", "reply", 11_000)).toBe(false);
    expect(db.recordTriageClear("chat-1", "m2", "reply", 12_000)).toBe(true);
    expect(db.countTriageClearsSince(10_500)).toBe(1);
  });
});
