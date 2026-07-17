/**
 * Exports contact thumbnail photos from the local macOS AddressBook stores to
 * .cache/avatars/<key>.img, keyed by last-10-digits of each phone and by
 * lowercased email. Run on the machine that owns the contacts (the Mini),
 * from a context with Full Disk Access (ssh works: sshd has FDA).
 *
 *   bun scripts/export-avatars.ts
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OUT_DIR = join(import.meta.dir, "..", ".cache", "avatars");
mkdirSync(OUT_DIR, { recursive: true });

const abRoot = join(homedir(), "Library", "Application Support", "AddressBook");
const dbPaths: string[] = [];
const rootDb = join(abRoot, "AddressBook-v22.abcddb");
if (existsSync(rootDb)) dbPaths.push(rootDb);
const sourcesDir = join(abRoot, "Sources");
if (existsSync(sourcesDir)) {
  for (const source of readdirSync(sourcesDir)) {
    const path = join(sourcesDir, source, "AddressBook-v22.abcddb");
    if (existsSync(path)) dbPaths.push(path);
  }
}

function keyOfPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

let written = 0;
for (const path of dbPaths) {
  const db = new Database(`file:${path}?mode=ro`, { readonly: true });
  try {
    const records = db
      .query(
        "SELECT Z_PK as pk, ZTHUMBNAILIMAGEDATA as img FROM ZABCDRECORD WHERE ZTHUMBNAILIMAGEDATA IS NOT NULL",
      )
      .all() as Array<{ pk: number; img: Uint8Array }>;
    if (records.length === 0) continue;
    const images = new Map(records.map((r) => [r.pk, r.img]));

    const phones = db
      .query("SELECT ZOWNER as owner, ZFULLNUMBER as value FROM ZABCDPHONENUMBER")
      .all() as Array<{ owner: number; value: string | null }>;
    const emails = db
      .query("SELECT ZOWNER as owner, ZADDRESS as value FROM ZABCDEMAILADDRESS")
      .all() as Array<{ owner: number; value: string | null }>;

    for (const { owner, value } of phones) {
      const img = images.get(owner);
      if (!img || !value) continue;
      const key = keyOfPhone(value);
      if (!key) continue;
      await Bun.write(join(OUT_DIR, `${key}.img`), img.slice().buffer as ArrayBuffer);
      written++;
    }
    for (const { owner, value } of emails) {
      const img = images.get(owner);
      if (!img || !value) continue;
      await Bun.write(
        join(OUT_DIR, `${value.toLowerCase().replace(/[^a-z0-9@._+-]/g, "_")}.img`),
        img.slice().buffer as ArrayBuffer,
      );
      written++;
    }
  } finally {
    db.close();
  }
}

console.log(`exported ${written} avatar keys from ${dbPaths.length} stores to ${OUT_DIR}`);
