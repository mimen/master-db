import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate } from "./migrate-one-triage-gesture";
import { verify, type Check } from "./verify-one-triage-gesture";

/**
 * The negative cases matter more than the positive one. A checker that cannot
 * report red is indistinguishable from a system that is fine.
 */

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

/** Two dismissals and two 'dismiss' reason rows, so a partial wipe is detectable. */
function seeded(): string {
  const path = join(mkdtempSync(join(tmpdir(), "comma-verify-")), "imsg.db");
  const db = new Database(path);
  db.exec(PRODUCTION_SCHEMA);
  db.exec(
    `INSERT INTO chat_state (chat_guid, archived_at, dismissed_unresponded_guid, dismissed_waiting_guid, pinned, read_at, later_until) VALUES
     ('a', 1750000000000, NULL, NULL, 0, 0, NULL),
     ('b', NULL, 'msg-1', NULL, 0, 0, NULL),
     ('c', NULL, NULL, 'msg-2', 1, 7, NULL)`,
  );
  db.exec(
    `INSERT INTO smart_closer_cache (chat_guid, inbound_message_guid, payload, created_at) VALUES ('a', 'm', '{}', 1)`,
  );
  db.exec(
    `INSERT INTO triage_clear_event (chat_guid, message_guid, reason, cleared_at) VALUES
     ('b', 'msg-1', 'dismiss', 1),
     ('c', 'msg-2', 'dismiss', 2),
     ('a', 'msg-9', 'reply', 3)`,
  );
  db.close();
  return path;
}

function migrated(): string {
  const path = seeded();
  migrate({ db: path, snapshot: false, log: () => undefined });
  return path;
}

function failed(checks: Check[]): string[] {
  return checks.filter((c) => !c.ok).map((c) => c.name);
}

const EXPECTED = { expectRows: 3, expectDismissals: 2, expectReasonRows: 2, expectClearEventsAtLeast: 3 };

describe("one-triage-gesture verification", () => {
  test("passes on a correctly migrated database", () => {
    const checks = verify({ db: migrated(), ...EXPECTED });

    expect(failed(checks)).toEqual([]);
    expect(checks.length).toBeGreaterThan(0);
  });

  test("fails when a retired column is still present", () => {
    const path = seeded();

    const checks = verify({ db: path, ...EXPECTED });

    expect(failed(checks)).toEqual([
      "chat_state.archived_at removed",
      "chat_state.later_until removed",
      "chat_state.later_anchor_guid removed",
      "table smart_closer_cache removed",
    ]);
  });

  test("fails when the migration overreached and took a surviving column", () => {
    const path = migrated();
    const db = new Database(path);
    db.exec("ALTER TABLE chat_state DROP COLUMN dismissed_waiting_guid");
    db.close();

    const checks = verify({ db: path, ...EXPECTED });

    // Two failures, not one: the column is gone AND the dismissal count is now
    // unanswerable. Both are true and both should be reported.
    expect(failed(checks)).toEqual(["chat_state.dismissed_waiting_guid preserved", "dismissals survived"]);
  });

  test("fails when dismissals were only PARTIALLY wiped", () => {
    const path = migrated();
    const db = new Database(path);
    db.exec("UPDATE chat_state SET dismissed_unresponded_guid = NULL WHERE chat_guid = 'b'");
    db.close();

    const checks = verify({ db: path, ...EXPECTED });

    // One dismissal survives. A greater-than-zero check would call this healthy,
    // which is exactly the overreach this checker exists to catch.
    expect(failed(checks)).toEqual(["dismissals survived"]);
  });

  test("fails when reason rows were only partially wiped", () => {
    const path = migrated();
    const db = new Database(path);
    db.exec("DELETE FROM triage_clear_event WHERE chat_guid = 'b'");
    db.close();

    const checks = verify({ db: path, expectRows: 3, expectDismissals: 2, expectReasonRows: 2 });

    expect(failed(checks)).toEqual(["stored reason values left alone"]);
  });

  test("fails when rows went missing", () => {
    const path = migrated();
    const db = new Database(path);
    db.exec("DELETE FROM chat_state WHERE chat_guid = 'a'");
    db.close();

    const checks = verify({ db: path, ...EXPECTED });

    expect(failed(checks)).toEqual(["chat_state row count unchanged"]);
  });

  test("fails when the clear-event log was truncated", () => {
    const path = migrated();
    const db = new Database(path);
    db.exec("DELETE FROM triage_clear_event");
    db.close();

    const checks = verify({ db: path, ...EXPECTED });

    expect(failed(checks)).toEqual(["triage_clear_event not truncated", "stored reason values left alone"]);
  });

  test("fails when every dismissal was wiped", () => {
    const path = migrated();
    const db = new Database(path);
    db.exec("UPDATE chat_state SET dismissed_unresponded_guid = NULL, dismissed_waiting_guid = NULL");
    db.close();

    const checks = verify({ db: path, ...EXPECTED });

    expect(failed(checks)).toEqual(["dismissals survived"]);
  });

  test("refuses a database that is not there", () => {
    expect(() => verify({ db: "/nonexistent/imsg.db" })).toThrow("no database at");
  });
});
