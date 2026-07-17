import { Database } from "bun:sqlite";

export interface ChatState {
  chatGuid: string;
  /** Epoch ms when the chat was archived; null = not archived. */
  archivedAt: number | null;
  /** Last-message GUID at the moment "unresponded" was dismissed. */
  dismissedUnrespondedGuid: string | null;
  /** Last-message GUID at the moment "waiting on them" was dismissed. */
  dismissedWaitingGuid: string | null;
  /** Chat never appears in the unresponded filter (group mute). */
  mutedUnresponded: number;
  pinned: number;
  /** Manually marked unread; cleared on next mark-read. */
  markedUnread: number;
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
