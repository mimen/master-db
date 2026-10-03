import { Database } from "bun:sqlite";
import type { ChatState } from "../shared/chat-state";

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
  private overlayListeners = new Set<(chatGuid: string) => void>();

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_state (
        chat_guid TEXT PRIMARY KEY,
        dismissed_unresponded_guid TEXT,
        dismissed_waiting_guid TEXT,
        muted_unresponded INTEGER NOT NULL DEFAULT 0
      );
    `);
    for (const ddl of [
      "ALTER TABLE chat_state ADD COLUMN marked_unread INTEGER NOT NULL DEFAULT 0;",
      "ALTER TABLE chat_state ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;",
      "ALTER TABLE chat_state ADD COLUMN read_at INTEGER NOT NULL DEFAULT 0;",
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
    // The shadow panel was removed; its transcript and brief cache go with it.
    this.db.exec("DROP TABLE IF EXISTS shadow_message; DROP TABLE IF EXISTS shadow_brief_cache;");
    // Small key/value store for AI state that is not per-chat (voice profile,
    // route cooldowns).
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

  onOverlayChange(listener: (chatGuid: string) => void): () => void {
    this.overlayListeners.add(listener);
    return () => { this.overlayListeners.delete(listener); };
  }

  private overlayChanged(chatGuid: string): void {
    for (const listener of this.overlayListeners) {
      try { listener(chatGuid); }
      catch (error) { console.error(`Overlay change listener failed: ${String(error)}`); }
    }
  }

  overlaySnapshot() {
    return {
      chatState: [...this.getAll().values()].map((state) => ({
        chatGuid: state.chatGuid,
        dismissedUnrespondedGuid: state.dismissedUnrespondedGuid ?? undefined,
        dismissedWaitingGuid: state.dismissedWaitingGuid ?? undefined,
        mutedUnresponded: state.mutedUnresponded === 1,
        markedUnread: state.markedUnread === 1,
        pinned: state.pinned === 1,
        readAt: state.readAt ?? 0,
      })),
      triageEvents: this.db.query<{ chatGuid: string; messageGuid: string; reason: "reply" | "dismiss"; clearedAt: number }, []>(
        `SELECT chat_guid AS chatGuid, message_guid AS messageGuid, reason, cleared_at AS clearedAt FROM triage_clear_event`,
      ).all(),
      triageOpen: this.db.query<{ chatGuid: string; messageGuid: string; openedAt: number }, []>(
        `SELECT chat_guid AS chatGuid, message_guid AS messageGuid, opened_at AS openedAt FROM triage_open_item`,
      ).all(),
    };
  }

  bridgeVersion(guid: string, fingerprint: string, baseVersion: number): number {
    this.db.exec(`CREATE TABLE IF NOT EXISTS comma_message_version (
      guid TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, version INTEGER NOT NULL
    );`);
    const prior = this.db.query<{ fingerprint: string; version: number }, [string]>(
      "SELECT fingerprint, version FROM comma_message_version WHERE guid = ?",
    ).get(guid);
    if (prior?.fingerprint === fingerprint && prior.version > baseVersion) return prior.version;
    // The counter is durable before upload. Identical retries keep the same version.
    // It starts above backfill's ROWID * 1000 and has no 999-revision ceiling.
    const version = Math.max(baseVersion, prior?.version ?? 0) + 1;
    if (!Number.isSafeInteger(version)) throw new Error("Comma message version overflow");
    this.db.query(`INSERT INTO comma_message_version (guid, fingerprint, version) VALUES (?, ?, ?)
      ON CONFLICT(guid) DO UPDATE SET fingerprint = excluded.fingerprint, version = excluded.version`)
      .run(guid, fingerprint, version);
    return version;
  }

  getBridgeCursor(target: string): number | null {
    this.db.exec("CREATE TABLE IF NOT EXISTS comma_cursor (target TEXT PRIMARY KEY, cursor INTEGER NOT NULL);");
    return this.db.query<{ cursor: number }, [string]>("SELECT cursor FROM comma_cursor WHERE target = ?")
      .get(target)?.cursor ?? null;
  }

  setBridgeCursor(target: string, cursor: number): void {
    this.getBridgeCursor(target);
    this.db.query(`INSERT INTO comma_cursor (target, cursor) VALUES (?, ?)
      ON CONFLICT(target) DO UPDATE SET cursor = excluded.cursor`).run(target, cursor);
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

  setOpenTriageItem(chatGuid: string, messageGuid: string, openedAt: number): void {
    this.db
      .query(
        `INSERT INTO triage_open_item (chat_guid, message_guid, opened_at) VALUES (?, ?, ?)
         ON CONFLICT(chat_guid) DO UPDATE SET
           message_guid = excluded.message_guid, opened_at = excluded.opened_at`,
      )
      .run(chatGuid, messageGuid, openedAt);
    this.overlayChanged(chatGuid);
  }

  getOpenTriageItem(chatGuid: string): { messageGuid: string; openedAt: number } | null {
    const row = this.db
      .query("SELECT message_guid, opened_at FROM triage_open_item WHERE chat_guid = ?")
      .get(chatGuid) as { message_guid: string; opened_at: number } | undefined;
    return row ? { messageGuid: row.message_guid, openedAt: row.opened_at } : null;
  }

  clearOpenTriageItem(chatGuid: string): void {
    this.db.query("DELETE FROM triage_open_item WHERE chat_guid = ?").run(chatGuid);
    this.overlayChanged(chatGuid);
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
    if (result.changes > 0) this.overlayChanged(chatGuid);
    return result.changes > 0;
  }

  deleteTriageClear(chatGuid: string, messageGuid: string): void {
    this.db
      .query("DELETE FROM triage_clear_event WHERE chat_guid = ? AND message_guid = ?")
      .run(chatGuid, messageGuid);
    this.overlayChanged(chatGuid);
  }

  countTriageClearsSince(since: number): number {
    const row = this.db
      .query("SELECT COUNT(*) AS count FROM triage_clear_event WHERE cleared_at >= ?")
      .get(since) as { count: number };
    return row.count;
  }

  // ----------------------------------------------------- comma media queue

  private mediaTable(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS comma_media_queue (
      guid TEXT PRIMARY KEY, mime_type TEXT, filename TEXT, created_at INTEGER NOT NULL,
      thumb_done INTEGER NOT NULL DEFAULT 0, original_done INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
    );`);
  }

  /** Queues on-disk attachments for Convex upload; an already-queued guid is left alone. */
  enqueueMedia(items: { guid: string; mimeType: string | null; filename: string | null; createdAt: number }[]): void {
    this.mediaTable();
    const insert = this.db.query(`INSERT INTO comma_media_queue (guid, mime_type, filename, created_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(guid) DO NOTHING`);
    for (const item of items) insert.run(item.guid, item.mimeType, item.filename, item.createdAt);
  }

  /** Newest first. Thumbnails drain before any original. Gives up on an item after 3 failures. */
  nextMedia(stage: "thumb" | "original", limit: number): { guid: string; mimeType: string | null; filename: string | null }[] {
    this.mediaTable();
    const column = stage === "thumb" ? "thumb_done" : "original_done";
    return this.db.query<{ guid: string; mimeType: string | null; filename: string | null }, [number]>(
      `SELECT guid, mime_type AS mimeType, filename FROM comma_media_queue
       WHERE ${column} = 0 AND attempts < 3 ORDER BY created_at DESC LIMIT ?`,
    ).all(limit);
  }

  markMedia(guid: string, stage: "thumb" | "original", error?: string): void {
    this.mediaTable();
    const column = stage === "thumb" ? "thumb_done" : "original_done";
    if (error) {
      this.db.query("UPDATE comma_media_queue SET attempts = attempts + 1, last_error = ? WHERE guid = ?").run(error, guid);
    } else {
      this.db.query(`UPDATE comma_media_queue SET ${column} = 1, attempts = 0, last_error = NULL WHERE guid = ?`).run(guid);
    }
  }

  mediaCounts(): { thumbsPending: number; originalsPending: number } {
    this.mediaTable();
    const row = this.db.query<{ thumbs: number; originals: number }, []>(
      `SELECT SUM(thumb_done = 0 AND attempts < 3) AS thumbs, SUM(original_done = 0 AND attempts < 3) AS originals
       FROM comma_media_queue`,
    ).get();
    return { thumbsPending: row?.thumbs ?? 0, originalsPending: row?.originals ?? 0 };
  }

  allTranscripts(): { attachmentGuid: string; text: string }[] {
    return this.db.query<{ attachmentGuid: string; text: string }, []>(
      "SELECT attachment_guid AS attachmentGuid, text FROM attachment_transcript",
    ).all();
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
        `SELECT chat_guid, dismissed_unresponded_guid,
                dismissed_waiting_guid, muted_unresponded, marked_unread, pinned, read_at
         FROM chat_state`,
      )
      .all() as Array<{
      chat_guid: string;
      dismissed_unresponded_guid: string | null;
      dismissed_waiting_guid: string | null;
      muted_unresponded: number;
      marked_unread: number;
      pinned: number;
      read_at: number;
    }>;
    const map = new Map<string, ChatState>();
    for (const row of rows) {
      map.set(row.chat_guid, {
        chatGuid: row.chat_guid,
        dismissedUnrespondedGuid: row.dismissed_unresponded_guid,
        dismissedWaitingGuid: row.dismissed_waiting_guid,
        mutedUnresponded: row.muted_unresponded,
        markedUnread: row.marked_unread,
        pinned: row.pinned,
        readAt: row.read_at,
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
    this.overlayChanged(chatGuid);
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

  setMutedUnresponded(chatGuid: string, muted: boolean): void {
    this.upsert(chatGuid, "muted_unresponded", muted ? 1 : 0);
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
