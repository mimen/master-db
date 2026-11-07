import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    conversation_id: "chat-1",
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
      id: "expired", conversation_id: "chat-1", suggestion_id: "s0", kind: "text",
      strategy: "clarify", vibe: "curious", selected_model: "opus", served_model: "opus",
      recipe_version: 3, suggested_text: "old", final_text: "old", selected_at: 0, sent_at: 0,
    });
    expect(db.listSuggestionFeedback()).toEqual([]);
  });

  test("stores feedback and deletes it with the chat", () => {
    db.addSuggestionFeedback({
      id: "f1", conversation_id: "chat-1", suggestion_id: "s1", kind: "text",
      strategy: "clarify", vibe: "curious", selected_model: "opus", served_model: "terra",
      recipe_version: 3, suggested_text: "what time?", final_text: "what time works?",
      selected_at: 10, sent_at: Date.now(),
    });
    expect(db.listSuggestionFeedback()).toHaveLength(1);
    db.deleteSuggestionLearningFor(["chat-1"]);
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

  test("an overlay keyed by BlueBubbles chat moves to conversation keys, dropping shelves that can never hit", () => {
    const path = join(mkdtempSync(join(tmpdir(), "overlay-")), "imsg.db");
    const old = new Database(path, { create: true });
    old.exec(`
      CREATE TABLE suggestion_result_cache (chat_guid TEXT NOT NULL, selected_model TEXT NOT NULL, anchor_guid TEXT NOT NULL,
        recipe_version INTEGER NOT NULL, voice_revision INTEGER NOT NULL, edit_revision INTEGER NOT NULL, payload TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY (chat_guid, selected_model));
      CREATE TABLE suggestion_feedback (id TEXT PRIMARY KEY, chat_guid TEXT NOT NULL, suggestion_id TEXT NOT NULL, kind TEXT NOT NULL,
        strategy TEXT NOT NULL, vibe TEXT NOT NULL, selected_model TEXT NOT NULL, served_model TEXT NOT NULL, recipe_version INTEGER NOT NULL,
        suggested_text TEXT NOT NULL, final_text TEXT NOT NULL, selected_at INTEGER NOT NULL, sent_at INTEGER NOT NULL);
    `);
    old.query("INSERT INTO suggestion_result_cache VALUES ('chat-1', 'opus', 'msg-1', 3, 1, 2, '{}', 1)").run();
    old.query(`INSERT INTO suggestion_feedback VALUES ('f1', 'chat-1', 's1', 'text', 'clarify', 'curious', 'opus', 'opus', 3, 'a', 'a', 1, ${Date.now()})`).run();
    old.close();
    const migrated = new OverlayDb(path);
    expect(migrated.getSuggestionCache("chat-1", "opus")).toBeNull();
    expect(migrated.listSuggestionFeedback().map((row) => row.conversation_id)).toEqual(["chat-1"]);
    migrated.setSuggestionCache({ conversation_id: "chat-1", selected_model: "opus", anchor_guid: "msg-2", recipe_version: 3, voice_revision: 1, edit_revision: 2, payload: "{}" });
    expect(new OverlayDb(path).getSuggestionCache("chat-1", "opus")?.anchor_guid).toBe("msg-2");
  });
});
