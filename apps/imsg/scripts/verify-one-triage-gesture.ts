#!/usr/bin/env bun
/**
 * Asserts the overlay database reached the post-migration state, and that the
 * migration took nothing it was not supposed to take.
 *
 * Runs on the Mini after the migration, read-only:
 *
 *   bun scripts/verify-one-triage-gesture.ts --expect-rows 318 --expect-clear-events 830
 *
 * Exits non-zero on the first failed assertion. The counts come from the
 * pre-change baseline, so this reads as old value versus new value rather than
 * as a bare pass.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { DROP_COLUMNS, DROP_TABLES } from "./migrate-one-triage-gesture";

export interface VerifyOptions {
  db: string;
  expectRows?: number;
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
    checks.push(
      hasDismissalColumns
        ? (() => {
            const n = (
              db
                .query(
                  "SELECT COUNT(*) AS n FROM chat_state WHERE dismissed_unresponded_guid IS NOT NULL OR dismissed_waiting_guid IS NOT NULL",
                )
                .get() as { n: number }
            ).n;
            return { name: "dismissals survived", ok: n > 0, detail: `${n} rows carry a dismissal` };
          })()
        : { name: "dismissals survived", ok: false, detail: "dismissal columns missing, cannot count" },
    );

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
    checks.push({
      name: "stored reason values left alone",
      ok: legacyReasons > 0,
      detail: hasClearEvents ? `${legacyReasons} rows still read 'dismiss'` : "table missing",
    });

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
  const checks = verify({
    db: dbFlag === -1 ? join(dirname(import.meta.dir), "imsg.db") : (argv[dbFlag + 1] ?? ""),
    expectRows: flag("--expect-rows"),
    expectClearEventsAtLeast: flag("--expect-clear-events"),
  });
  for (const check of checks) console.log(`${check.ok ? "ok  " : "FAIL"} ${check.name}: ${check.detail}`);
  const failed = checks.filter((c) => !c.ok);
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}
