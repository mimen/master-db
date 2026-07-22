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

export interface SuggestionCacheRow {
  chat_guid: string;
  last_message_guid: string | null;
  payload: string;
  created_at: number;
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
    ]) {
      try {
        this.db.exec(ddl);
      } catch {
        // column already exists
      }
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_message (
        id TEXT PRIMARY KEY,
        chat_guid TEXT NOT NULL,
        text TEXT NOT NULL,
        send_at INTEGER NOT NULL
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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS suggestion_cache (
        chat_guid TEXT PRIMARY KEY,
        last_message_guid TEXT,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
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

  getSuggestionCache(chatGuid: string): SuggestionCacheRow | null {
    return (
      (this.db
        .query(
          "SELECT chat_guid, last_message_guid, payload, created_at FROM suggestion_cache WHERE chat_guid = ?",
        )
        .get(chatGuid) as SuggestionCacheRow | undefined) ?? null
    );
  }

  setSuggestionCache(chatGuid: string, lastMessageGuid: string | null, payload: string): void {
    this.db
      .query(
        `INSERT INTO suggestion_cache (chat_guid, last_message_guid, payload, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(chat_guid) DO UPDATE SET
           last_message_guid = excluded.last_message_guid,
           payload = excluded.payload,
           created_at = excluded.created_at`,
      )
      .run(chatGuid, lastMessageGuid, payload, Date.now());
  }

  // ------------------------------------------------------- scheduled messages

  listScheduled(): Array<{ id: string; chatGuid: string; text: string; sendAt: number }> {
    return (
      this.db
        .query("SELECT id, chat_guid, text, send_at FROM scheduled_message ORDER BY send_at ASC")
        .all() as Array<{ id: string; chat_guid: string; text: string; send_at: number }>
    ).map((r) => ({ id: r.id, chatGuid: r.chat_guid, text: r.text, sendAt: r.send_at }));
  }

  addScheduled(id: string, chatGuid: string, text: string, sendAt: number): void {
    this.db
      .query("INSERT INTO scheduled_message (id, chat_guid, text, send_at) VALUES (?, ?, ?, ?)")
      .run(id, chatGuid, text, sendAt);
  }

  removeScheduled(id: string): void {
    this.db.query("DELETE FROM scheduled_message WHERE id = ?").run(id);
  }

  dueScheduled(now: number): Array<{ id: string; chatGuid: string; text: string; sendAt: number }> {
    return this.listScheduled().filter((s) => s.sendAt <= now);
  }

  getAll(): Map<string, ChatState> {
    const rows = this.db
      .query(
        `SELECT chat_guid, archived_at, dismissed_unresponded_guid,
                dismissed_waiting_guid, muted_unresponded, marked_unread, pinned
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

  setArchived(chatGuid: string, archived: boolean): void {
    this.upsert(chatGuid, "archived_at", archived ? Date.now() : null);
  }

  dismissUnresponded(chatGuid: string, lastMessageGuid: string): void {
    this.upsert(chatGuid, "dismissed_unresponded_guid", lastMessageGuid);
  }

  dismissWaiting(chatGuid: string, lastMessageGuid: string): void {
    this.upsert(chatGuid, "dismissed_waiting_guid", lastMessageGuid);
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
}
