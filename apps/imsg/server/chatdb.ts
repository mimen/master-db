import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Message } from "../shared/types";
import type { NameSource } from "./name-resolver";

/** Apple stores message dates as ns since 2001-01-01; convert to epoch ms. */
const APPLE_EPOCH_MS = 978_307_200_000;
function appleToEpochMs(raw: number | null): number {
  if (!raw) return 0;
  // Newer macOS uses nanoseconds; older used seconds. Detect by magnitude.
  return raw > 1e12 ? Math.round(raw / 1e6) + APPLE_EPOCH_MS : raw * 1000 + APPLE_EPOCH_MS;
}

interface DbRow {
  guid: string;
  text: string | null;
  attributed: Uint8Array | null;
  date: number;
  is_from_me: number;
  chat_guid: string | null;
  handle: string | null;
}

export interface ChatDbHit {
  guid: string;
  chatGuid: string;
  text: string;
  dateCreated: number;
  isFromMe: boolean;
  sender: { address: string; name: string | null } | null;
}

/**
 * Read-only full-history search directly against the Mac's Messages database.
 * BlueBubbles only exposes a shallow recent window; chat.db has everything.
 * The attributedBody blob is decoded heuristically for the ~post-Ventura rows
 * whose plain `text` column is null.
 */
export class ChatDb {
  private db: Database | null = null;

  private open(): Database | null {
    if (this.db) return this.db;
    const path = process.env.CHATDB_PATH ?? join(homedir(), "Library", "Messages", "chat.db");
    try {
      this.db = new Database(`file:${path}?mode=ro`, { readonly: true });
      return this.db;
    } catch {
      return null;
    }
  }

  /** True when the local chat.db is reachable (Full Disk Access granted). */
  available(): boolean {
    return this.open() !== null;
  }

  /**
   * Substring search. `chatGuid` scopes to one conversation (in-thread search);
   * omit for global. Newest first.
   */
  search(
    query: string,
    contacts: NameSource,
    options: { chatGuid?: string; from?: "me" | "them"; limit?: number } = {},
  ): Message[] {
    const db = this.open();
    const needle = query.trim();
    if (!db || needle.length < 2) return [];
    const limit = Math.min(options.limit ?? 60, 200);

    const conditions: string[] = ["m.text LIKE :q ESCAPE '\\'"];
    const params: Record<string, string | number> = {
      $q: `%${needle.replace(/[%_\\]/g, "\\$&")}%`,
    };
    if (options.chatGuid) {
      conditions.push("c.guid = :chat");
      params.$chat = options.chatGuid;
    }
    if (options.from === "me") conditions.push("m.is_from_me = 1");
    if (options.from === "them") conditions.push("m.is_from_me = 0");

    const sql = `
      SELECT m.guid AS guid, m.text AS text, m.attributedBody AS attributed,
             m.date AS date, m.is_from_me AS is_from_me,
             c.guid AS chat_guid, h.id AS handle
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY m.date DESC
      LIMIT ${limit}
    `.replaceAll(":q", "$q").replaceAll(":chat", "$chat");

    let rows: DbRow[];
    try {
      rows = db.query(sql).all(params) as DbRow[];
    } catch {
      return [];
    }

    return rows.map((row) => {
      const text = row.text ?? decodeAttributedBody(row.attributed) ?? "";
      const address = row.handle ?? null;
      return {
        guid: row.guid,
        chatGuid: row.chat_guid ?? "",
        text,
        dateCreated: appleToEpochMs(row.date),
        dateRead: null,
        dateDelivered: null,
        isFromMe: row.is_from_me === 1,
        service: "iMessage",
        sender:
          row.is_from_me === 1 || !address
            ? null
            : { address, name: contacts.lookup(address) },
        attachments: [],
        special: null,
        sendEffect: null,
        reactions: [],
        replyToGuid: null,
        replyToPreview: null,
        replyToFromMe: null,
        isGroupEvent: false,
        error: 0,
        edited: false,
        retracted: false,
      } satisfies Message;
    });
  }
}

/**
 * Post-Ventura rows store the body as an NSAttributedkeyed-archiver blob with
 * a null `text` column. The plain string sits between an `NSString`/`+` marker
 * and the next class name; this extracts it heuristically without a full
 * typedstream parser.
 */
function decodeAttributedBody(blob: Uint8Array | null): string | null {
  if (!blob || blob.length === 0) return null;
  const raw = Buffer.from(blob).toString("latin1");
  const marker = raw.indexOf("NSString");
  if (marker < 0) return null;
  // After NSString there's a class-table byte, a length prefix, then the text.
  const slice = raw.slice(marker + 8);
  const start = slice.search(/[^\x00-\x1f\x81-\x93]/);
  if (start < 0) return null;
  let end = slice.indexOf("\x86", start); // 0x86 ends the string object
  if (end < 0) end = slice.indexOf("\x00\x00", start);
  const text = (end > start ? slice.slice(start, end) : slice.slice(start, start + 2000))
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .trim();
  return text.length > 0 ? text : null;
}
