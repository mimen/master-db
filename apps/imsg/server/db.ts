import { Database } from "bun:sqlite";
import type { ChatState } from "../shared/chat-state";

export type ShadowRole = "user" | "assistant";

export interface ShadowMessageRow {
  id: string;
  chat_guid: string;
  role: ShadowRole;
  text: string;
  created_at: number;
}

export interface AiMessageCacheRow {
  chat_guid: string;
  message_guid: string;
  payload: string;
  created_at: number;
}

export interface SmartCloserCacheRow {
  chat_guid: string;
  inbound_message_guid: string;
  payload: string;
  created_at: number;
}

export interface SuggestionCacheRow {
  chat_guid: string;
  selected_model: string;
  anchor_guid: string;
  recipe_version: number;
  voice_revision: number;
  edit_revision: number;
  payload: string;
  created_at: number;
}

export interface SuggestionFeedbackRow {
  id: string;
  chat_guid: string;
  suggestion_id: string;
  kind: string;
  strategy: string;
  vibe: string;
  selected_model: string;
  served_model: string;
  recipe_version: number;
  suggested_text: string;
  final_text: string;
  selected_at: number;
  sent_at: number;
}

export class OverlayDb {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_state (
        chat_guid TEXT PRIMARY KEY,
        archived_at INTEGER,
        dismissed_unresponded_guid TEXT,
        dismissed_waiting_guid TEXT,
        muted_unresponded INTEGER NOT NULL DEFAULT 0
      );
    `);
    for (const ddl of [
      "ALTER TABLE chat_state ADD COLUMN marked_unread INTEGER NOT NULL DEFAULT 0;",
      "ALTER TABLE chat_state ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;",
      "ALTER TABLE chat_state ADD COLUMN read_at INTEGER NOT NULL DEFAULT 0;",
      "ALTER TABLE chat_state ADD COLUMN later_until INTEGER;",
      "ALTER TABLE chat_state ADD COLUMN later_anchor_guid TEXT;",
    ]) {
      try {
        this.db.exec(ddl);
      } catch {
        // column already exists
      }
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS attachment_transcript (
        attachment_guid TEXT PRIMARY KEY,
        text TEXT NOT NULL
      );
    `);
    // Shadow-conversation transcript. The server owns this rather than the
    // harness: the UI has to render it, and replaying it keeps each delegated
    // turn stateless.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shadow_message (
        id TEXT PRIMARY KEY,
        chat_guid TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_shadow_message_chat ON shadow_message(chat_guid, created_at);",
    );
    // Small key/value store for AI state that is not per-chat — currently the
    // CCS anchor session uuid, which must survive restarts to keep cost rollup
    // pointed at one parent.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    // Suggestion shelf cache. Keyed by the last message guid seen when it was
    // generated, which is what makes the staleness check a string compare.
    // Versioned suggestion results. The selected route participates in the key,
    // so web and Expo clients with different preferences never share a shelf.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS suggestion_result_cache (
        chat_guid TEXT NOT NULL,
        selected_model TEXT NOT NULL,
        anchor_guid TEXT NOT NULL,
        recipe_version INTEGER NOT NULL,
        voice_revision INTEGER NOT NULL,
        edit_revision INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (chat_guid, selected_model)
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS suggestion_feedback (
        id TEXT PRIMARY KEY,
        chat_guid TEXT NOT NULL,
        suggestion_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        strategy TEXT NOT NULL,
        vibe TEXT NOT NULL,
        selected_model TEXT NOT NULL,
        served_model TEXT NOT NULL,
        recipe_version INTEGER NOT NULL,
        suggested_text TEXT NOT NULL,
        final_text TEXT NOT NULL,
        selected_at INTEGER NOT NULL,
        sent_at INTEGER NOT NULL
      );
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_suggestion_feedback_sent ON suggestion_feedback(sent_at DESC);",
    );
    // Version 3 invalidates the old string-array cache and removes its private text.
    this.db.exec("DROP TABLE IF EXISTS suggestion_cache;");
    this.pruneSuggestionFeedback();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS smart_closer_cache (
        chat_guid TEXT PRIMARY KEY,
        inbound_message_guid TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shadow_brief_cache (
        chat_guid TEXT PRIMARY KEY,
        message_guid TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS triage_clear_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_guid TEXT NOT NULL,
        message_guid TEXT NOT NULL,
        reason TEXT NOT NULL,
        cleared_at INTEGER NOT NULL,
        UNIQUE(chat_guid, message_guid)
      );
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_triage_clear_event_at ON triage_clear_event(cleared_at);",
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS triage_open_item (
        chat_guid TEXT PRIMARY KEY,
        message_guid TEXT NOT NULL,
        opened_at INTEGER NOT NULL
      );
    `);
  }

  // ------------------------------------------------------------------ ai state

  getAiMeta(key: string): string | null {
    const row = this.db.query("SELECT value FROM ai_meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setAiMeta(key: string, value: string): void {
    this.db
      .query(
        `INSERT INTO ai_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  listShadowMessages(chatGuid: string): ShadowMessageRow[] {
    return this.db
      .query(
        `SELECT id, chat_guid, role, text, created_at FROM shadow_message
         WHERE chat_guid = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(chatGuid) as ShadowMessageRow[];
  }

  addShadowMessage(id: string, chatGuid: string, role: ShadowRole, text: string): ShadowMessageRow {
    const createdAt = Date.now();
    this.db
      .query(
        "INSERT INTO shadow_message (id, chat_guid, role, text, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, chatGuid, role, text, createdAt);
    return { id, chat_guid: chatGuid, role, text, created_at: createdAt };
  }

  clearShadowMessages(chatGuid: string): void {
    this.db.query("DELETE FROM shadow_message WHERE chat_guid = ?").run(chatGuid);
  }

  getSuggestionCache(chatGuid: string, selectedModel: string): SuggestionCacheRow | null {
    return (
      (this.db
        .query(
          `SELECT chat_guid, selected_model, anchor_guid, recipe_version,
                  voice_revision, edit_revision, payload, created_at
           FROM suggestion_result_cache
           WHERE chat_guid = ? AND selected_model = ?`,
        )
        .get(chatGuid, selectedModel) as SuggestionCacheRow | undefined) ?? null
    );
  }

  setSuggestionCache(row: Omit<SuggestionCacheRow, "created_at">): void {
    this.db
      .query(
        `INSERT INTO suggestion_result_cache (
           chat_guid, selected_model, anchor_guid, recipe_version,
           voice_revision, edit_revision, payload, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_guid, selected_model) DO UPDATE SET
           anchor_guid = excluded.anchor_guid,
           recipe_version = excluded.recipe_version,
           voice_revision = excluded.voice_revision,
           edit_revision = excluded.edit_revision,
           payload = excluded.payload,
           created_at = excluded.created_at`,
      )
      .run(
        row.chat_guid,
        row.selected_model,
        row.anchor_guid,
        row.recipe_version,
        row.voice_revision,
        row.edit_revision,
        row.payload,
        Date.now(),
      );
  }

  addSuggestionFeedback(row: SuggestionFeedbackRow): void {
    this.db
      .query(
        `INSERT INTO suggestion_feedback (
           id, chat_guid, suggestion_id, kind, strategy, vibe,
           selected_model, served_model, recipe_version, suggested_text,
           final_text, selected_at, sent_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.chat_guid,
        row.suggestion_id,
        row.kind,
        row.strategy,
        row.vibe,
        row.selected_model,
        row.served_model,
        row.recipe_version,
        row.suggested_text,
        row.final_text,
        row.selected_at,
        row.sent_at,
      );
    this.pruneSuggestionFeedback();
  }

  pruneSuggestionFeedback(now = Date.now()): void {
    const cutoff = now - 90 * 24 * 60 * 60_000;
    this.db.query("DELETE FROM suggestion_feedback WHERE sent_at < ?").run(cutoff);
    this.db.exec(`
      DELETE FROM suggestion_feedback
      WHERE id NOT IN (
        SELECT id FROM suggestion_feedback ORDER BY sent_at DESC, rowid DESC LIMIT 200
      );
    `);
  }

  listSuggestionFeedback(limit = 20): SuggestionFeedbackRow[] {
    return this.db
      .query(
        `SELECT id, chat_guid, suggestion_id, kind, strategy, vibe,
                selected_model, served_model, recipe_version, suggested_text,
                final_text, selected_at, sent_at
         FROM suggestion_feedback
         ORDER BY sent_at DESC, rowid DESC LIMIT ?`,
      )
      .all(Math.min(Math.max(limit, 1), 200)) as SuggestionFeedbackRow[];
  }

  deleteSuggestionFeedbackForChat(chatGuid: string): void {
    this.db.query("DELETE FROM suggestion_feedback WHERE chat_guid = ?").run(chatGuid);
    this.db.query("DELETE FROM suggestion_result_cache WHERE chat_guid = ?").run(chatGuid);
  }

  clearSuggestionLearning(): void {
    this.db.exec("DELETE FROM suggestion_feedback; DELETE FROM suggestion_result_cache; DROP TABLE IF EXISTS suggestion_cache;");
    for (const key of ["suggestion_voice_profile_v1", "suggestion_edit_rules_v1"]) {
      this.db.query("DELETE FROM ai_meta WHERE key = ?").run(key);
    }
  }

  getShadowBriefCache(chatGuid: string): AiMessageCacheRow | null {
    return (
      (this.db
        .query(
          `SELECT chat_guid, message_guid, payload, created_at
           FROM shadow_brief_cache WHERE chat_guid = ?`,
        )
        .get(chatGuid) as AiMessageCacheRow | undefined) ?? null
    );
  }

  setShadowBriefCache(chatGuid: string, messageGuid: string, payload: string): void {
    this.db
      .query(
        `INSERT INTO shadow_brief_cache (chat_guid, message_guid, payload, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(chat_guid) DO UPDATE SET
           message_guid = excluded.message_guid,
           payload = excluded.payload,
           created_at = excluded.created_at`,
      )
      .run(chatGuid, messageGuid, payload, Date.now());
  }

  getSmartCloserCache(chatGuid: string): SmartCloserCacheRow | null {
    return (
      (this.db
        .query(
          `SELECT chat_guid, inbound_message_guid, payload, created_at
           FROM smart_closer_cache WHERE chat_guid = ?`,
        )
        .get(chatGuid) as SmartCloserCacheRow | undefined) ?? null
    );
  }

  setSmartCloserCache(chatGuid: string, inboundMessageGuid: string, payload: string): void {
    this.db
      .query(
        `INSERT INTO smart_closer_cache (chat_guid, inbound_message_guid, payload, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(chat_guid) DO UPDATE SET
           inbound_message_guid = excluded.inbound_message_guid,
           payload = excluded.payload,
           created_at = excluded.created_at`,
      )
      .run(chatGuid, inboundMessageGuid, payload, Date.now());
  }

  setOpenTriageItem(chatGuid: string, messageGuid: string, openedAt: number): void {
    this.db
      .query(
        `INSERT INTO triage_open_item (chat_guid, message_guid, opened_at) VALUES (?, ?, ?)
         ON CONFLICT(chat_guid) DO UPDATE SET
           message_guid = excluded.message_guid, opened_at = excluded.opened_at`,
      )
      .run(chatGuid, messageGuid, openedAt);
  }

  getOpenTriageItem(chatGuid: string): { messageGuid: string; openedAt: number } | null {
    const row = this.db
      .query("SELECT message_guid, opened_at FROM triage_open_item WHERE chat_guid = ?")
      .get(chatGuid) as { message_guid: string; opened_at: number } | undefined;
    return row ? { messageGuid: row.message_guid, openedAt: row.opened_at } : null;
  }

  clearOpenTriageItem(chatGuid: string): void {
    this.db.query("DELETE FROM triage_open_item WHERE chat_guid = ?").run(chatGuid);
  }

  recordTriageClear(
    chatGuid: string,
    messageGuid: string,
    reason: "dismiss" | "reply",
    clearedAt: number = Date.now(),
  ): boolean {
    const result = this.db
      .query(
        `INSERT OR IGNORE INTO triage_clear_event
         (chat_guid, message_guid, reason, cleared_at) VALUES (?, ?, ?, ?)`,
      )
      .run(chatGuid, messageGuid, reason, clearedAt);
    return result.changes > 0;
  }

  deleteTriageClear(chatGuid: string, messageGuid: string): void {
    this.db
      .query("DELETE FROM triage_clear_event WHERE chat_guid = ? AND message_guid = ?")
      .run(chatGuid, messageGuid);
  }

  countTriageClearsSince(since: number): number {
    const row = this.db
      .query("SELECT COUNT(*) AS count FROM triage_clear_event WHERE cleared_at >= ?")
      .get(since) as { count: number };
    return row.count;
  }

  // --------------------------------------------------- attachment transcripts

  getAttachmentTranscript(attachmentGuid: string): string | null {
    const row = this.db
      .query("SELECT text FROM attachment_transcript WHERE attachment_guid = ?")
      .get(attachmentGuid) as { text: string } | undefined;
    return row?.text ?? null;
  }

  setAttachmentTranscript(attachmentGuid: string, text: string): void {
    this.db
      .query(
        `INSERT INTO attachment_transcript (attachment_guid, text)
         VALUES (?, ?)
         ON CONFLICT(attachment_guid) DO UPDATE SET text = excluded.text`,
      )
      .run(attachmentGuid, text);
  }

  getAll(): Map<string, ChatState> {
    const rows = this.db
      .query(
        `SELECT chat_guid, archived_at, dismissed_unresponded_guid,
                dismissed_waiting_guid, muted_unresponded, marked_unread, pinned, read_at,
                later_until, later_anchor_guid
         FROM chat_state`,
      )
      .all() as Array<{
      chat_guid: string;
      archived_at: number | null;
      dismissed_unresponded_guid: string | null;
      dismissed_waiting_guid: string | null;
      muted_unresponded: number;
      marked_unread: number;
      pinned: number;
      read_at: number;
      later_until: number | null;
      later_anchor_guid: string | null;
    }>;
    const map = new Map<string, ChatState>();
    for (const row of rows) {
      map.set(row.chat_guid, {
        chatGuid: row.chat_guid,
        archivedAt: row.archived_at,
        dismissedUnrespondedGuid: row.dismissed_unresponded_guid,
        dismissedWaitingGuid: row.dismissed_waiting_guid,
        mutedUnresponded: row.muted_unresponded,
        markedUnread: row.marked_unread,
        pinned: row.pinned,
        readAt: row.read_at,
        laterUntil: row.later_until,
        laterAnchorGuid: row.later_anchor_guid,
      });
    }
    return map;
  }

  private upsert(chatGuid: string, column: string, value: string | number | null): void {
    this.db
      .query(
        `INSERT INTO chat_state (chat_guid, ${column}) VALUES (?, ?)
         ON CONFLICT(chat_guid) DO UPDATE SET ${column} = excluded.${column}`,
      )
      .run(chatGuid, value);
  }

  clearExpiredLater(now: number): string[] {
    const rows = this.db
      .query("SELECT chat_guid FROM chat_state WHERE later_until IS NOT NULL AND later_until <= ?")
      .all(now) as Array<{ chat_guid: string }>;
    if (rows.length > 0) {
      this.db
        .query(
          `UPDATE chat_state SET later_until = NULL, later_anchor_guid = NULL
           WHERE later_until IS NOT NULL AND later_until <= ?`,
        )
        .run(now);
    }
    return rows.map((row) => row.chat_guid);
  }

  setLater(chatGuid: string, until: number | null, anchorGuid: string | null): void {
    this.db.transaction(() => {
      this.upsert(chatGuid, "later_until", until);
      this.upsert(chatGuid, "later_anchor_guid", until === null ? null : anchorGuid);
    })();
  }

  setArchived(chatGuid: string, archived: boolean): void {
    this.upsert(chatGuid, "archived_at", archived ? Date.now() : null);
  }

  dismissUnresponded(chatGuid: string, lastMessageGuid: string): void {
    this.upsert(chatGuid, "dismissed_unresponded_guid", lastMessageGuid);
  }

  dismissWaiting(chatGuid: string, lastMessageGuid: string): void {
    this.upsert(chatGuid, "dismissed_waiting_guid", lastMessageGuid);
  }

  clearDismissal(chatGuid: string, kind: "unresponded" | "waiting"): void {
    this.upsert(
      chatGuid,
      kind === "unresponded" ? "dismissed_unresponded_guid" : "dismissed_waiting_guid",
      null,
    );
  }

  setMarkedUnread(chatGuid: string, unread: boolean): void {
    this.upsert(chatGuid, "marked_unread", unread ? 1 : 0);
  }

  setPinned(chatGuid: string, pinned: boolean): void {
    this.upsert(chatGuid, "pinned", pinned ? 1 : 0);
  }

  setReadAt(chatGuid: string, at: number): void {
    this.upsert(chatGuid, "read_at", at);
  }
}
