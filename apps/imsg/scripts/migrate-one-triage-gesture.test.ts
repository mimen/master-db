import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate } from "./migrate-one-triage-gesture";

/** The exact production chat_state shape at f408980, including the ALTER-appended columns. */
const PRODUCTION_SCHEMA = `
  CREATE TABLE chat_state (
    chat_guid TEXT PRIMARY KEY,
    archived_at INTEGER,
    dismissed_unresponded_guid TEXT,
    dismissed_waiting_guid TEXT,
    muted_unresponded INTEGER NOT NULL DEFAULT 0
  , marked_unread INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, read_at INTEGER NOT NULL DEFAULT 0, later_until INTEGER, later_anchor_guid TEXT);
  CREATE TABLE smart_closer_cache (
    chat_guid TEXT PRIMARY KEY,
    inbound_message_guid TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE triage_clear_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_guid TEXT NOT NULL,
    message_guid TEXT NOT NULL,
    reason TEXT NOT NULL,
    cleared_at INTEGER NOT NULL,
    UNIQUE(chat_guid, message_guid)
  );
`;

function fixture(): string {
  const path = join(mkdtempSync(join(tmpdir(), "comma-migrate-")), "imsg.db");
  const db = new Database(path);
  db.exec(PRODUCTION_SCHEMA);
  db.exec(
    `INSERT INTO chat_state (chat_guid, archived_at, dismissed_unresponded_guid, dismissed_waiting_guid, pinned, read_at, later_until, later_anchor_guid) VALUES
     ('chat-archived', 1750000000000, NULL, NULL, 0, 0, NULL, NULL),
     ('chat-dismissed', NULL, 'msg-1', NULL, 0, 0, NULL, NULL),
     ('chat-waiting-dismissed', NULL, NULL, 'msg-2', 1, 5, NULL, NULL),
     ('chat-later', NULL, NULL, NULL, 0, 0, 1760000000000, 'msg-3'),
     ('chat-clean', NULL, NULL, NULL, 0, 0, NULL, NULL)`,
  );
  db.exec(
    `INSERT INTO smart_closer_cache (chat_guid, inbound_message_guid, payload, created_at)
     VALUES ('chat-clean', 'msg-9', '{"kind":"done","label":"Done"}', 1750000000001)`,
  );
  db.exec(
    `INSERT INTO triage_clear_event (chat_guid, message_guid, reason, cleared_at)
     VALUES ('chat-dismissed', 'msg-1', 'dismiss', 1750000000002)`,
  );
  db.close();
  return path;
}

function columns(path: string): string[] {
  const db = new Database(path, { readonly: true });
  const names = (db.query("PRAGMA table_info(chat_state)").all() as Array<{ name: string }>).map((r) => r.name);
  db.close();
  return names;
}

function tables(path: string): string[] {
  const db = new Database(path, { readonly: true });
  const names = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
  db.close();
  return names;
}

const silent = (): void => undefined;

describe("one-triage-gesture migration", () => {
  test("drops exactly the retired columns and table", () => {
    const path = fixture();

    const result = migrate({ db: path, snapshot: false, log: silent });

    expect(result.columnsDropped).toEqual(["archived_at", "later_until", "later_anchor_guid"]);
    expect(result.tablesDropped).toEqual(["smart_closer_cache"]);
    expect(columns(path)).toEqual([
      "chat_guid",
      "dismissed_unresponded_guid",
      "dismissed_waiting_guid",
      "muted_unresponded",
      "marked_unread",
      "pinned",
      "read_at",
    ]);
    expect(tables(path)).toEqual(["chat_state", "sqlite_sequence", "triage_clear_event"]);
  });

  test("preserves every row and the surviving column values", () => {
    const path = fixture();

    migrate({ db: path, snapshot: false, log: silent });

    const db = new Database(path, { readonly: true });
    const rows = db
      .query("SELECT chat_guid, dismissed_unresponded_guid, dismissed_waiting_guid, pinned, read_at FROM chat_state ORDER BY chat_guid")
      .all();
    db.close();

    expect(rows).toEqual([
      { chat_guid: "chat-archived", dismissed_unresponded_guid: null, dismissed_waiting_guid: null, pinned: 0, read_at: 0 },
      { chat_guid: "chat-clean", dismissed_unresponded_guid: null, dismissed_waiting_guid: null, pinned: 0, read_at: 0 },
      { chat_guid: "chat-dismissed", dismissed_unresponded_guid: "msg-1", dismissed_waiting_guid: null, pinned: 0, read_at: 0 },
      { chat_guid: "chat-later", dismissed_unresponded_guid: null, dismissed_waiting_guid: null, pinned: 0, read_at: 0 },
      { chat_guid: "chat-waiting-dismissed", dismissed_unresponded_guid: null, dismissed_waiting_guid: "msg-2", pinned: 1, read_at: 5 },
    ]);
  });

  test("leaves triage_clear_event rows untouched", () => {
    const path = fixture();

    migrate({ db: path, snapshot: false, log: silent });

    const db = new Database(path, { readonly: true });
    const events = db.query("SELECT chat_guid, reason FROM triage_clear_event").all();
    db.close();

    expect(events).toEqual([{ chat_guid: "chat-dismissed", reason: "dismiss" }]);
  });

  test("a second run converges instead of failing", () => {
    const path = fixture();

    migrate({ db: path, snapshot: false, log: silent });
    const second = migrate({ db: path, snapshot: false, log: silent });

    expect(second.alreadyMigrated).toBe(true);
    expect(second.columnsDropped).toEqual([]);
    expect(second.rowsPreserved).toBe(5);
  });

  test("dry run reports the work without performing it", () => {
    const path = fixture();

    const result = migrate({ db: path, dryRun: true, snapshot: false, log: silent });

    expect(result.alreadyMigrated).toBe(false);
    expect(result.columnsDropped).toEqual([]);
    expect(result.rowsPreserved).toBe(5);
    expect(columns(path)).toContain("archived_at");
    expect(tables(path)).toContain("smart_closer_cache");
  });

  // No test that a dry run survives a held EXCLUSIVE lock. An exclusive lock
  // blocks readers too, so nothing can read under one. That is SQLite, not a
  // property of this script. The narrower true claim, that a dry run never
  // writes, is covered by the dry-run test above.

  test("refuses to migrate while another connection holds the database", () => {
    const path = fixture();
    const holder = new Database(path);
    holder.exec("BEGIN EXCLUSIVE");

    try {
      expect(() => migrate({ db: path, snapshot: false, log: silent })).toThrow("exclusive lock");
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }

    // Nothing was dropped, so a refused run leaves the database exactly as found.
    expect(columns(path)).toContain("archived_at");
    expect(tables(path)).toContain("smart_closer_cache");
  });

  test("writes a readable snapshot before touching the database", () => {
    const path = fixture();

    const result = migrate({ db: path, log: silent });

    expect(result.snapshotPath).not.toBeNull();
    expect(result.snapshotReused).toBe(false);
    expect(existsSync(result.snapshotPath!)).toBe(true);
    expect(columns(result.snapshotPath!)).toContain("archived_at");
    expect(columns(path)).not.toContain("archived_at");
  });

  test("a retry reuses the first snapshot instead of capturing a half-migrated one", () => {
    const path = fixture();
    const existing = `${path}.pre-one-triage-gesture.2020-01-01T00-00-00-000Z`;
    const source = new Database(path);
    source.exec(`VACUUM INTO '${existing}'`);
    source.close();

    const result = migrate({ db: path, log: silent });

    expect(result.snapshotReused).toBe(true);
    expect(result.snapshotPath).toBe(existing);
    // The reused image is still pre-migration, which is the whole point.
    expect(columns(existing)).toContain("archived_at");
  });

  test("refuses a database that is not there", () => {
    expect(() => migrate({ db: "/nonexistent/imsg.db", log: silent })).toThrow("no database at");
  });
});
