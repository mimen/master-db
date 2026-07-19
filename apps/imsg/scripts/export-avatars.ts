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

/**
 * ZTHUMBNAILIMAGEDATA formats seen in the wild:
 *   0x01 + raw image bytes            (inline)
 *   0x02 + ASCII UUID                 (pointer into .AddressBook-v22_SUPPORT/_EXTERNAL_DATA/)
 *   raw image bytes                   (no prefix)
 */
function looksLikeImage(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true; // JPEG
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return true; // PNG
  const ftyp = new TextDecoder().decode(bytes.slice(4, 8));
  return ftyp === "ftyp"; // HEIC/HEIF
}

async function resolveImage(dbPath: string, blob: Uint8Array): Promise<Uint8Array | null> {
  if (blob.length > 2 && blob[0] === 0x02 && blob.length < 64) {
    const uuid = new TextDecoder().decode(blob.slice(1)).replace(/[^A-Za-z0-9-]/g, "");
    const external = join(dbPath, "..", ".AddressBook-v22_SUPPORT", "_EXTERNAL_DATA", uuid);
    const file = Bun.file(external);
    if (await file.exists()) return new Uint8Array(await file.arrayBuffer());
    return null;
  }
  if (looksLikeImage(blob)) return blob;
  const stripped = blob.slice(1);
  if (looksLikeImage(stripped)) return stripped;
  return null;
}

/** HEIC/HEIF → JPEG via sips; JPEG/PNG pass through. */
async function normalizeToBrowserImage(pk: number, bytes: Uint8Array): Promise<Uint8Array> {
  const isHeif = new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp";
  if (!isHeif) return bytes;
  const tmpIn = join(OUT_DIR, `.tmp-${pk}.heic`);
  const tmpOut = join(OUT_DIR, `.tmp-${pk}.jpg`);
  await Bun.write(tmpIn, bytes.slice().buffer as ArrayBuffer);
  const proc = Bun.spawn(["sips", "-s", "format", "jpeg", tmpIn, "--out", tmpOut], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const ok = (await proc.exited) === 0 && (await Bun.file(tmpOut).exists());
  const result = ok ? new Uint8Array(await Bun.file(tmpOut).arrayBuffer()) : bytes;
  await Bun.file(tmpIn).delete().catch(() => undefined);
  await Bun.file(tmpOut).delete().catch(() => undefined);
  return result;
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
    const images = new Map<number, Uint8Array>();
    for (const r of records) {
      const resolved = await resolveImage(path, r.img);
      if (resolved && resolved.length > 100) {
        images.set(r.pk, await normalizeToBrowserImage(r.pk, resolved));
      }
    }

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
