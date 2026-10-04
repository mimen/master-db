import { Database } from "bun:sqlite";
import type { MessageWriter } from "./live";
import { RetryWork } from "./retry";

/**
 * Per chat, the inbound messages newer than its last read or sent message. Apple
 * never back-fills is_read on some old group rows, so a later read or reply
 * settles everything before it, the way Messages.app's own badge does.
 */
const UNREAD_SQL = `
WITH seen AS (
  SELECT j.chat_id, MAX(m.date) AS date FROM message m JOIN chat_message_join j ON j.message_id = m.ROWID
  WHERE m.is_from_me = 1 OR m.is_read = 1 GROUP BY j.chat_id)
SELECT c.guid AS chatGuid, COUNT(*) AS count, MIN(m.date) AS first
FROM message m
JOIN chat_message_join j ON j.message_id = m.ROWID
JOIN chat c ON c.ROWID = j.chat_id
LEFT JOIN seen s ON s.chat_id = j.chat_id
WHERE m.is_from_me = 0 AND m.is_read = 0 AND m.associated_message_type = 0 AND m.item_type = 0
  AND m.group_action_type = 0 AND m.date_retracted = 0 AND m.date > COALESCE(s.date, 0)
GROUP BY c.guid`;

const APPLE_EPOCH_MS = 978_307_200_000;

/** chat.db dates are nanoseconds since 2001, or seconds on rows from old macOS versions. */
export function appleDateToMs(date: number): number {
  return APPLE_EPOCH_MS + (date > 1e12 ? Math.round(date / 1e6) : date * 1000);
}

/** Mirrors chat.db's unread state into Convex after every arrival and read-status change. */
export class UnreadMirror {
  private chatDb: Database | null = null;
  private work: RetryWork;
  private timer: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;

  constructor(writer: MessageWriter, options: { chatDbPath?: string } = {}) {
    try {
      this.chatDb = new Database(options.chatDbPath ?? Bun.env.CHATDB_PATH ?? `${Bun.env.HOME}/Library/Messages/chat.db`, { readonly: true });
    } catch (error) {
      console.warn(`comma bridge unread: chat.db unavailable, unread stays empty. ${String(error)}`);
    }
    this.work = new RetryWork("unread", () => writer.exclusive(async () => {
      if (!this.chatDb) return;
      const rows = this.chatDb.query<{ chatGuid: string; count: number; first: number }, []>(UNREAD_SQL).all();
      await writer.deps.ingest.post("unread", {
        chats: rows.map((row) => ({ chatGuid: row.chatGuid, count: row.count, firstAt: appleDateToMs(row.first) })),
      });
    }));
    this.unsubscribe = writer.deps.bb.onEvent((event) => {
      if (event.kind === "new-message" || event.kind === "updated-message" || event.kind === "chat-read-status-changed") {
        this.work.request(500);
      }
    });
    this.timer = setInterval(() => this.work.request(), 2 * 60_000);
    this.timer.unref();
    this.work.request();
  }

  get pending(): number { return this.work.pending; }
  flush(): Promise<void> { return this.work.flush(); }
  stop(): void {
    this.unsubscribe();
    clearInterval(this.timer);
    this.work.stop();
    void this.work.flush().then(() => { this.chatDb?.close(); this.chatDb = null; });
  }
}
