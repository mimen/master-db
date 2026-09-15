#!/usr/bin/env bun
/**
 * Retires Archive, Later and SmartCloser from the overlay database.
 *
 * Runs on the Mini, after the code that stops reading these columns is already
 * deployed. Never run it from a branch preview: previews use a scratch database
 * and pointing this at production from one is a documented unsafe bypass.
 *
 *   bun scripts/migrate-one-triage-gesture.ts --db <path> --dry-run
 *   bun scripts/migrate-one-triage-gesture.ts --db <path>
 *
 * Pass --db explicitly. This script does not read .env, so the default path is
 * a guess and the server's DB_PATH may point elsewhere.
 *
 * ## The server must be stopped first
 *
 * com.milad.imsg is a KeepAlive LaunchAgent, so killing bun is not enough;
 * launchd restarts it and reopens the database mid-run. A migration racing a
 * live writer risks SQLITE_BUSY at best and a running server holding prepared
 * statements against a changed schema at worst.
 *
 *   launchctl bootout gui/$(id -u)/com.milad.imsg
 *   bun scripts/migrate-one-triage-gesture.ts --db <path>
 *   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.milad.imsg.plist
 *
 * The script does not take this on trust. Before it reads anything it sets a
 * busy timeout and acquires a genuine EXCLUSIVE lock, so a live writer fails the
 * run loudly instead of racing it. The order matters: an exclusive lock held
 * elsewhere blocks readers too, so a lock check placed after the inspection
 * queries would surface as a bare "database is locked" from whichever SELECT
 * ran first, rather than as an instruction to stop the server.
 *
 * ## Restore, if it goes wrong
 *
 * The snapshot is a VACUUM INTO copy, which is consistent against a hot WAL in
 * a way a file copy is not. It is NOT a drop-in replacement while the database
 * is live. To restore:
 *
 *   1. launchctl bootout gui/$(id -u)/com.milad.imsg
 *   2. rm -f <db>-wal <db>-shm          # stale WAL against a restored file corrupts
 *   3. cp <db>.pre-one-triage-gesture.<FIRST timestamp> <db>
 *   4. launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.milad.imsg.plist
 *
 * Use the FIRST snapshot, not the newest. A retry after a partial run would
 * otherwise capture a half-migrated database, so this script refuses to take a
 * second snapshot when one already exists.
 *
 * Restoring loses any overlay writes that landed after the snapshot. Reverting
 * the app does NOT bring archived_at back: it was declared in CREATE TABLE, not
 * in the ALTER TABLE ADD COLUMN loop, so an older build boots against the
 * migrated table without recreating it. Those values are the only irreversible
 * data in this change.
 *
 * Safe to re-run. Every step checks whether it already applied, so a crash
 * halfway leaves the next run converging to the same end state.
 */
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const DROP_COLUMNS = ["archived_at", "later_until", "later_anchor_guid"] as const;
export const DROP_TABLES = ["smart_closer_cache"] as const;

const SNAPSHOT_MARKER = ".pre-one-triage-gesture.";
const BUSY_TIMEOUT_MS = 5000;

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
  snapshotReused: boolean;
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

/**
 * Proves no other connection holds the database, rather than assuming it. A
 * KeepAlive LaunchAgent means "I killed the server" is not evidence.
 */
function assertNoOtherWriter(db: Database): void {
  try {
    db.exec("BEGIN EXCLUSIVE");
    db.exec("ROLLBACK");
  } catch (error) {
    throw new Error(
      `could not take an exclusive lock, something else has the database open. ` +
        `Stop the server first: launchctl bootout gui/$(id -u)/com.milad.imsg  (${String(error)})`,
    );
  }
}

/** The original pre-migration image, if a previous run already took one. */
function findExistingSnapshot(dbPath: string): string | null {
  const dir = dirname(dbPath);
  const prefix = `${basename(dbPath)}${SNAPSHOT_MARKER}`;
  const found = readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .sort();
  return found.length > 0 ? join(dir, found[0]!) : null;
}

/** VACUUM INTO, not a file copy: the database has a hot WAL a copy would miss. */
function writeSnapshot(db: Database, dbPath: string, log: (line: string) => void): string {
  const existing = findExistingSnapshot(dbPath);
  if (existing) {
    // A retry must not overwrite the pre-migration image with a half-migrated one.
    log(`snapshot: reusing the existing pre-migration image at ${existing}`);
    return existing;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = `${dbPath}${SNAPSHOT_MARKER}${stamp}`;
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

  // A dry run must never write, so it opens read-only and takes no lock.
  const db = new Database(options.db, options.dryRun ? { readonly: true } : undefined);
  try {
    // Before any query. An exclusive lock held elsewhere blocks reads as well as
    // writes, so a check placed after the inspection SELECTs never runs.
    //
    // The precondition itself waits for nothing. If another connection holds the
    // database, waiting cannot help, because the only fix is to stop the server.
    // Fail immediately with that instruction, then allow a short wait for the
    // transient contention of this script's own work.
    if (!options.dryRun) {
      db.exec("PRAGMA busy_timeout = 0");
      assertNoOtherWriter(db);
    }
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);

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

    if (columnsToDrop.length === 0 && tablesToDrop.length === 0) {
      const rows = (db.query("SELECT COUNT(*) AS n FROM chat_state").get() as { n: number }).n;
      log("nothing to do, already migrated");
      return {
        columnsDropped: [],
        tablesDropped: [],
        snapshotPath: null,
        snapshotReused: false,
        rowsPreserved: rows,
        alreadyMigrated: true,
      };
    }

    if (options.dryRun) {
      const rows = (db.query("SELECT COUNT(*) AS n FROM chat_state").get() as { n: number }).n;
      log("dry run, read-only, no writes");
      return {
        columnsDropped: [],
        tablesDropped: [],
        snapshotPath: null,
        snapshotReused: false,
        rowsPreserved: rows,
        alreadyMigrated: false,
      };
    }

    const existingBefore = findExistingSnapshot(options.db);
    const snapshotPath = takeSnapshot ? writeSnapshot(db, options.db, log) : null;
    const snapshotReused = takeSnapshot && existingBefore !== null;

    // Count inside the same transaction as the drops. Counting outside it let a
    // concurrent insert make a completed migration report failure, which is the
    // worst possible lie: it invites a restore over a database that was fine.
    db.exec("BEGIN EXCLUSIVE");
    let rowsPreserved: number;
    try {
      rowsPreserved = (db.query("SELECT COUNT(*) AS n FROM chat_state").get() as { n: number }).n;
      for (const c of columnsToDrop) {
        db.exec(`ALTER TABLE chat_state DROP COLUMN ${c}`);
        log(`dropped column ${c}`);
      }
      for (const t of tablesToDrop) {
        db.exec(`DROP TABLE ${t}`);
        log(`dropped table ${t}`);
      }
      const rowsAfter = (db.query("SELECT COUNT(*) AS n FROM chat_state").get() as { n: number }).n;
      if (rowsAfter !== rowsPreserved) {
        throw new Error(`row count changed during migration: ${rowsPreserved} before, ${rowsAfter} after`);
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

    log(`chat_state columns now: ${after.join(", ")}`);
    log(`chat_state rows preserved: ${rowsPreserved}`);

    return {
      columnsDropped: [...columnsToDrop],
      tablesDropped: [...tablesToDrop],
      snapshotPath,
      snapshotReused,
      rowsPreserved,
      alreadyMigrated: false,
    };
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const dbFlag = argv.indexOf("--db");
  if (dbFlag === -1) {
    console.error("--db is required. This script does not read .env, so it cannot guess the server's DB_PATH.");
    process.exit(2);
  }
  migrate({
    db: argv[dbFlag + 1] ?? "",
    dryRun: argv.includes("--dry-run"),
    snapshot: !argv.includes("--no-snapshot"),
  });
}
