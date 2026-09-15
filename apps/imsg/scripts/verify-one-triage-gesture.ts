#!/usr/bin/env bun
/**
 * Asserts the overlay database reached the post-migration state, and that the
 * migration took nothing it was not supposed to take.
 *
 * Runs on the Mini after the migration, read-only:
 *
 *   bun scripts/verify-one-triage-gesture.ts --db <path> \
 *     --expect-rows N --expect-dismissals N --expect-reason-rows N --expect-clear-events N
 *
 * RECAPTURE THE EXPECTED COUNTS IMMEDIATELY BEFORE MIGRATING. They are exact
 * comparisons, and the overlay is written by a live app, so numbers taken hours
 * earlier will fail a migration that actually succeeded. Take them in the same
 * sitting as the dry run:
 *
 *   sqlite3 -readonly <db> "SELECT
 *     (SELECT COUNT(*) FROM chat_state),
 *     (SELECT COUNT(*) FROM chat_state WHERE dismissed_unresponded_guid IS NOT NULL
 *                                         OR dismissed_waiting_guid IS NOT NULL),
 *     (SELECT COUNT(*) FROM triage_clear_event WHERE reason = 'dismiss'),
 *     (SELECT COUNT(*) FROM triage_clear_event);"
 *
 * Exits non-zero on the first failed assertion.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

import { DROP_COLUMNS, DROP_TABLES } from "./migrate-one-triage-gesture";

export interface VerifyOptions {
  db: string;
  expectRows?: number;
  /** Exact count of rows carrying either dismissal anchor. */
  expectDismissals?: number;
  /** Exact count of triage_clear_event rows whose reason is 'dismiss'. */
  expectReasonRows?: number;
  expectClearEventsAtLeast?: number;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export function verify(options: VerifyOptions): Check[] {
  if (!existsSync(options.db)) throw new Error(`no database at ${options.db}`);
  const db = new Database(options.db, { readonly: true });
  try {
    const columns = (db.query("PRAGMA table_info(chat_state)").all() as Array<{ name: string }>).map((r) => r.name);
    const tables = (
      db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    ).map((r) => r.name);
    const checks: Check[] = [];

    for (const column of DROP_COLUMNS) {
      const present = columns.includes(column);
      checks.push({
        name: `chat_state.${column} removed`,
        ok: !present,
        detail: present ? "still present" : "absent",
      });
    }
    for (const table of DROP_TABLES) {
      const present = tables.includes(table);
      checks.push({ name: `table ${table} removed`, ok: !present, detail: present ? "still present" : "absent" });
    }

    // The surviving triage state is the whole point of the change. If these went
    // missing the migration overreached, and the snapshot is the way back.
    for (const column of ["dismissed_unresponded_guid", "dismissed_waiting_guid", "pinned", "marked_unread", "read_at", "muted_unresponded"]) {
      const present = columns.includes(column);
      checks.push({
        name: `chat_state.${column} preserved`,
        ok: present,
        detail: present ? "present" : "MISSING",
      });
    }

    const rows = (db.query("SELECT COUNT(*) AS n FROM chat_state").get() as { n: number }).n;
    if (options.expectRows !== undefined) {
      checks.push({
        name: "chat_state row count unchanged",
        ok: rows === options.expectRows,
        detail: `${rows} rows, expected ${options.expectRows}`,
      });
    }

    // Guarded on schema presence: a checker that throws when something is missing
    // cannot be distinguished from a checker that is broken.
    const hasDismissalColumns =
      columns.includes("dismissed_unresponded_guid") && columns.includes("dismissed_waiting_guid");
    if (!hasDismissalColumns) {
      checks.push({ name: "dismissals survived", ok: false, detail: "dismissal columns missing, cannot count" });
    } else {
      const n = (
        db
          .query(
            "SELECT COUNT(*) AS n FROM chat_state WHERE dismissed_unresponded_guid IS NOT NULL OR dismissed_waiting_guid IS NOT NULL",
          )
          .get() as { n: number }
      ).n;
      // Exact, not greater-than-zero. A near-total wipe leaving one row would
      // otherwise pass the very check written to catch a wipe.
      checks.push(
        options.expectDismissals === undefined
          ? { name: "dismissals survived", ok: n > 0, detail: `${n} rows carry a dismissal, no expected count given` }
          : {
              name: "dismissals survived",
              ok: n === options.expectDismissals,
              detail: `${n} rows carry a dismissal, expected ${options.expectDismissals}`,
            },
      );
    }

    const hasClearEvents = tables.includes("triage_clear_event");
    const events = hasClearEvents
      ? (db.query("SELECT COUNT(*) AS n FROM triage_clear_event").get() as { n: number }).n
      : -1;
    if (options.expectClearEventsAtLeast !== undefined) {
      checks.push({
        name: "triage_clear_event not truncated",
        ok: hasClearEvents && events >= options.expectClearEventsAtLeast,
        detail: hasClearEvents
          ? `${events} events, expected at least ${options.expectClearEventsAtLeast}`
          : "table missing",
      });
    }

    const legacyReasons = hasClearEvents
      ? (db.query("SELECT COUNT(*) AS n FROM triage_clear_event WHERE reason = 'dismiss'").get() as { n: number }).n
      : 0;
    checks.push(
      options.expectReasonRows === undefined
        ? {
            name: "stored reason values left alone",
            ok: legacyReasons > 0,
            detail: hasClearEvents ? `${legacyReasons} rows read 'dismiss', no expected count given` : "table missing",
          }
        : {
            name: "stored reason values left alone",
            ok: legacyReasons === options.expectReasonRows,
            detail: hasClearEvents
              ? `${legacyReasons} rows read 'dismiss', expected ${options.expectReasonRows}`
              : "table missing",
          },
    );

    return checks;
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const flag = (name: string): number | undefined => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : Number(argv[i + 1]);
  };
  const dbFlag = argv.indexOf("--db");
  if (dbFlag === -1) {
    console.error("--db is required. This script does not read .env, so it cannot guess the server's DB_PATH.");
    process.exit(2);
  }
  const checks = verify({
    db: argv[dbFlag + 1] ?? "",
    expectRows: flag("--expect-rows"),
    expectDismissals: flag("--expect-dismissals"),
    expectReasonRows: flag("--expect-reason-rows"),
    expectClearEventsAtLeast: flag("--expect-clear-events"),
  });
  for (const check of checks) console.log(`${check.ok ? "ok  " : "FAIL"} ${check.name}: ${check.detail}`);
  const failed = checks.filter((c) => !c.ok);
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}
