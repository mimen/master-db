#!/usr/bin/env bun
/**
 * Retires Archive, Later and SmartCloser from the overlay database.
 *
 * Runs on the Mini, after the code that stops reading these columns is already
 * deployed. Never run it from a branch preview: previews use a scratch database
 * and pointing this at production from one is a documented unsafe bypass.
 *
 *   bun scripts/migrate-one-triage-gesture.ts --dry-run
 *   bun scripts/migrate-one-triage-gesture.ts
 *
 * Safe to re-run. Every step checks whether it already applied, so a crash
 * halfway leaves the next run converging to the same end state rather than
 * failing on an already-dropped column.
 */
import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export const DROP_COLUMNS = ["archived_at", "later_until", "later_anchor_guid"] as const;
export const DROP_TABLES = ["smart_closer_cache"] as const;

export interface MigrateOptions {
  db: string;
  dryRun?: boolean;
  snapshot?: boolean;
  log?: (line: string) => void;
}

export interface MigrateResult {
  columnsDropped: string[];
  tablesDropped: string[];
  snapshotPath: string | null;
  rowsPreserved: number;
  alreadyMigrated: boolean;
}

function columnsOf(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name);
}

function tableExists(db: Database, table: string): boolean {
  return (
    db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== null
  );
}

/** VACUUM INTO, not a file copy: the database has a hot WAL that a copy would miss. */
function writeSnapshot(db: Database, dbPath: string, log: (line: string) => void): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = `${dbPath}.pre-one-triage-gesture.${stamp}`;
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const verify = new Database(target, { readonly: true });
  const rows = (verify.query("SELECT COUNT(*) AS n FROM chat_state").get() as { n: number }).n;
  verify.close();
  if (rows === 0) throw new Error(`snapshot at ${target} verified empty, refusing to migrate`);
  log(`snapshot: ${target} (${rows} chat_state rows, readable)`);
  return target;
}

export function migrate(options: MigrateOptions): MigrateResult {
  const log = options.log ?? ((line: string) => console.log(line));
  const takeSnapshot = options.snapshot !== false;

  if (!existsSync(options.db)) throw new Error(`no database at ${options.db}`);
  log(`database: ${options.db} (${statSync(options.db).size} bytes)`);

  const db = new Database(options.db);
  try {
    const before = columnsOf(db, "chat_state");
    const columnsToDrop = DROP_COLUMNS.filter((c) => before.includes(c));
    const tablesToDrop = DROP_TABLES.filter((t) => tableExists(db, t));

    log(`chat_state columns present: ${before.join(", ")}`);
    for (const c of columnsToDrop) {
      const n = (db.query(`SELECT COUNT(*) AS n FROM chat_state WHERE ${c} IS NOT NULL`).get() as { n: number }).n;
      log(`  will drop ${c} (${n} non-null rows)`);
    }
    for (const t of tablesToDrop) {
      const n = (db.query(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
      log(`  will drop table ${t} (${n} rows)`);
    }

    const rowsPreserved = (db.query("SELECT COUNT(*) AS n FROM chat_state").get() as { n: number }).n;

    if (columnsToDrop.length === 0 && tablesToDrop.length === 0) {
      log("nothing to do, already migrated");
      return { columnsDropped: [], tablesDropped: [], snapshotPath: null, rowsPreserved, alreadyMigrated: true };
    }

    if (options.dryRun) {
      log("dry run, no writes");
      return { columnsDropped: [], tablesDropped: [], snapshotPath: null, rowsPreserved, alreadyMigrated: false };
    }

    const snapshotPath = takeSnapshot ? writeSnapshot(db, options.db, log) : null;

    db.exec("BEGIN");
    try {
      for (const c of columnsToDrop) {
        db.exec(`ALTER TABLE chat_state DROP COLUMN ${c}`);
        log(`dropped column ${c}`);
      }
      for (const t of tablesToDrop) {
        db.exec(`DROP TABLE ${t}`);
        log(`dropped table ${t}`);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const after = columnsOf(db, "chat_state");
    const leftover = [
      ...DROP_COLUMNS.filter((c) => after.includes(c)),
      ...DROP_TABLES.filter((t) => tableExists(db, t)),
    ];
    if (leftover.length > 0) throw new Error(`migration incomplete: ${leftover.join(", ")} still present`);

    const rowsAfter = (db.query("SELECT COUNT(*) AS n FROM chat_state").get() as { n: number }).n;
    if (rowsAfter !== rowsPreserved) {
      throw new Error(`row count changed during migration: ${rowsPreserved} before, ${rowsAfter} after`);
    }
    log(`chat_state columns now: ${after.join(", ")}`);
    log(`chat_state rows preserved: ${rowsAfter}`);

    return {
      columnsDropped: [...columnsToDrop],
      tablesDropped: [...tablesToDrop],
      snapshotPath,
      rowsPreserved: rowsAfter,
      alreadyMigrated: false,
    };
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const dbFlag = argv.indexOf("--db");
  migrate({
    db: dbFlag === -1 ? join(dirname(import.meta.dir), "imsg.db") : (argv[dbFlag + 1] ?? ""),
    dryRun: argv.includes("--dry-run"),
    snapshot: !argv.includes("--no-snapshot"),
  });
}
