#!/usr/bin/env bun
/**
 * Phase B uploader — copies Beeper's locally-cached attachment bytes into
 * Convex File Storage, dedupes by Matrix mxc_id, and records each
 * (mxc_id → convex_storage_id) mapping via /beeper/attachments/record.
 *
 * Phase A already ingested every message with its `attachments[].mxc_id`
 * metadata. This script:
 *
 *   1. Walks Beeper's API once to enumerate every (mxc_id, srcURL, mime,
 *      size) tuple referenced by messages in the given account.
 *   2. Dedupes by mxc_id (same media file often appears in many messages).
 *   3. Asks Convex which mxc_ids are already uploaded (resumable: skips them).
 *   4. For each missing mxc_id, in parallel:
 *        - Verify the file exists at the local srcURL path.
 *        - Ask Convex for an upload URL.
 *        - PUT the bytes — Convex returns a { storageId } on success.
 *        - POST the storage id + metadata to /beeper/attachments/record.
 *   5. Logs progress and saves a local manifest (.beeper-attachments-progress.json)
 *      so subsequent runs only re-fetch attachment metadata from Beeper.
 *
 * Usage:
 *   bun run scripts/upload-beeper-attachments.ts                        # WhatsApp
 *   bun run scripts/upload-beeper-attachments.ts --account gmessages    # SMS
 *   bun run scripts/upload-beeper-attachments.ts --limit 10 --dry-run   # smoke test
 *   bun run scripts/upload-beeper-attachments.ts --concurrency 16
 *
 * Env (read from .env.local):
 *   BEEPER_URL                 (default http://localhost:23373/v1)
 *   BEEPER_ACCESS_TOKEN
 *   CONVEX_INGEST_URL          base URL for /beeper/* (no trailing path)
 *   BEEPER_INGEST_SECRET
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------- args + env -------------------------------------

type Args = {
  account: string;
  limit?: number;
  limitChats?: number;
  concurrency: number;
  dryRun: boolean;
  refresh: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { account: "whatsapp", concurrency: 8, dryRun: false, refresh: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--account") args.account = argv[++i] ?? args.account;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--limit-chats") args.limitChats = Number(argv[++i]);
    else if (a === "--concurrency") args.concurrency = Math.max(1, Number(argv[++i]));
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--refresh") args.refresh = true;
    else if (a === "--help" || a === "-h") { console.log(usage()); process.exit(0); }
  }
  return args;
}

function usage(): string {
  return `Usage: bun run scripts/upload-beeper-attachments.ts [--account whatsapp] [--limit-chats N] [--limit N] [--concurrency N] [--dry-run] [--refresh]`;
}

const ARGS = parseArgs(Bun.argv.slice(2));

const BEEPER_URL = process.env.BEEPER_URL ?? "http://localhost:23373/v1";
const BEEPER_TOKEN = process.env.BEEPER_ACCESS_TOKEN;
const INGEST_BASE = (process.env.CONVEX_INGEST_URL ?? "").replace(/\/beeper\/ingest\/?$/, "");
const INGEST_SECRET = process.env.BEEPER_INGEST_SECRET;

if (!BEEPER_TOKEN) die("BEEPER_ACCESS_TOKEN not set");
if (!ARGS.dryRun && !INGEST_BASE) die("CONVEX_INGEST_URL not set");
if (!ARGS.dryRun && !INGEST_SECRET) die("BEEPER_INGEST_SECRET not set");

const PROGRESS_PATH = join(import.meta.dir, ".beeper-attachments-progress.json");

const ENDPOINTS = {
  discover: `${INGEST_BASE}/beeper/attachments/discover`,
  uploadUrl: `${INGEST_BASE}/beeper/attachments/uploadUrl`,
  record: `${INGEST_BASE}/beeper/attachments/record`,
};

// ---------------------------- types ------------------------------------------

type AttachmentMeta = {
  mxc_id: string;
  network: string;
  src_path: string;
  mime_type?: string;
  file_name?: string;
  file_size?: number;
  width?: number;
  height?: number;
  duration_ms?: number;
};

interface BeeperListResp<T> { items: T[]; hasMore: boolean; oldestCursor: string | null }

interface BeeperChatLite { id: string; network: string; title?: string }

interface BeeperAttachment {
  id: string; type?: string; mimeType?: string; fileName?: string;
  fileSize?: number; isGif?: boolean; isSticker?: boolean;
  size?: { width?: number; height?: number }; duration?: number; srcURL?: string;
}

interface BeeperMessage {
  id: string; chatID: string; timestamp?: string;
  attachments?: BeeperAttachment[];
}

// ---------------------------- HTTP -------------------------------------------

async function beeperGet<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await fetch(`${BEEPER_URL}${path}`, {
        headers: { Authorization: `Bearer ${BEEPER_TOKEN}` },
      });
      if (!res.ok) throw new Error(`Beeper ${res.status} ${res.statusText} for ${path}`);
      return (await res.json()) as T;
    } catch (e) {
      if (attempt === 4) throw e;
      await sleep(250 * 2 ** attempt);
    }
  }
  throw new Error("unreachable");
}

async function convexPost<T>(url: string, body: unknown): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${INGEST_SECRET}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`POST ${url} → ${res.status} ${res.statusText}: ${text}`);
      }
      return (await res.json()) as T;
    } catch (e) {
      if (attempt === 4) throw e;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw new Error("unreachable");
}

// ---------------------------- collect attachments -----------------------------

async function fetchAllChats(account: string): Promise<BeeperChatLite[]> {
  const chats: BeeperChatLite[] = [];
  let cursor: string | null = null;
  while (true) {
    const qs = new URLSearchParams({ accountIDs: account, limit: "200" });
    if (cursor) qs.set("cursor", cursor);
    const data = await beeperGet<BeeperListResp<BeeperChatLite>>(
      `/chats/search?${qs.toString()}`,
    );
    chats.push(...data.items);
    if (!data.hasMore || !data.oldestCursor) break;
    cursor = data.oldestCursor;
    await sleep(20);
  }
  return chats;
}

async function fetchAttachmentsForChat(chat: BeeperChatLite): Promise<AttachmentMeta[]> {
  const enc = encodeURIComponent(chat.id);
  const out: AttachmentMeta[] = [];
  let cursor: string | null = null;
  while (true) {
    const qs = new URLSearchParams({ limit: "500" });
    if (cursor) qs.set("cursor", cursor);
    const data = await beeperGet<BeeperListResp<BeeperMessage>>(
      `/chats/${enc}/messages?${qs.toString()}`,
    );
    for (const m of data.items) {
      for (const a of m.attachments ?? []) {
        if (!a.id) continue;
        const srcPath = a.srcURL ? fileURLToLocalPath(a.srcURL) : undefined;
        if (!srcPath) continue;
        out.push({
          mxc_id: a.id,
          network: chat.network,
          src_path: srcPath,
          mime_type: a.mimeType,
          file_name: a.fileName,
          file_size: a.fileSize,
          width: a.size?.width,
          height: a.size?.height,
          duration_ms: a.duration,
        });
      }
    }
    if (!data.hasMore || !data.oldestCursor) break;
    cursor = data.oldestCursor;
    await sleep(20);
  }
  return out;
}

function fileURLToLocalPath(srcURL: string): string | undefined {
  if (!srcURL.startsWith("file://")) return undefined;
  try {
    return fileURLToPath(srcURL);
  } catch {
    return undefined;
  }
}

// ---------------------------- progress ---------------------------------------

type Progress = {
  account: string;
  deployment: string;
  uploaded: Record<string, string>; // mxc_id → storage_id
  failed: Record<string, string>;   // mxc_id → last error
  updatedAt: string;
};

// Storage IDs are deployment-scoped, so we key progress by (deployment_host,
// account). Same script, two deployments → two independent buckets.
function deploymentKey(): string {
  if (ARGS.dryRun) return "dry-run";
  try { return new URL(INGEST_BASE).host; } catch { return "unknown"; }
}

function progressKey(account: string): string {
  return `${deploymentKey()}::${account}`;
}

function loadProgress(account: string): Progress {
  const key = progressKey(account);
  if (!existsSync(PROGRESS_PATH)) {
    return { account, deployment: deploymentKey(), uploaded: {}, failed: {}, updatedAt: new Date().toISOString() };
  }
  const all = JSON.parse(readFileSync(PROGRESS_PATH, "utf8")) as Record<string, Progress>;
  return all[key] ?? {
    account, deployment: deploymentKey(),
    uploaded: {}, failed: {}, updatedAt: new Date().toISOString(),
  };
}

function saveProgress(p: Progress): void {
  let all: Record<string, Progress> = {};
  if (existsSync(PROGRESS_PATH)) {
    all = JSON.parse(readFileSync(PROGRESS_PATH, "utf8")) as Record<string, Progress>;
  }
  p.updatedAt = new Date().toISOString();
  all[progressKey(p.account)] = p;
  writeFileSync(PROGRESS_PATH, JSON.stringify(all, null, 2));
}

// ---------------------------- upload one --------------------------------------

async function uploadOne(att: AttachmentMeta): Promise<{ ok: true; storageId: string } | { ok: false; error: string }> {
  if (!existsSync(att.src_path)) {
    return { ok: false, error: `missing local file: ${att.src_path}` };
  }
  let onDiskSize: number | undefined;
  try {
    onDiskSize = statSync(att.src_path).size;
  } catch (e) {
    return { ok: false, error: `stat failed: ${(e as Error).message}` };
  }

  // 1) ask for an upload URL
  let uploadUrl: string;
  try {
    const resp = await convexPost<{ uploadUrl: string }>(ENDPOINTS.uploadUrl, {});
    uploadUrl = resp.uploadUrl;
  } catch (e) {
    return { ok: false, error: `uploadUrl: ${(e as Error).message}` };
  }

  // 2) PUT the bytes (Convex's upload URL expects POST with the file body)
  let storageId: string;
  try {
    const file = Bun.file(att.src_path);
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: att.mime_type ? { "Content-Type": att.mime_type } : {},
      body: file,
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `upload PUT ${res.status}: ${text}` };
    }
    const json = (await res.json()) as { storageId?: string };
    if (!json.storageId) return { ok: false, error: "upload response missing storageId" };
    storageId = json.storageId;
  } catch (e) {
    return { ok: false, error: `upload bytes: ${(e as Error).message}` };
  }

  // 3) record the mapping
  try {
    await convexPost(ENDPOINTS.record, {
      mxc_id: att.mxc_id,
      convex_storage_id: storageId,
      network: att.network,
      mime_type: att.mime_type,
      file_name: att.file_name,
      file_size: att.file_size ?? onDiskSize,
      width: att.width,
      height: att.height,
      duration_ms: att.duration_ms,
    });
  } catch (e) {
    return { ok: false, error: `record: ${(e as Error).message}` };
  }

  return { ok: true, storageId };
}

// ---------------------------- main -------------------------------------------

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
function die(msg: string): never { console.error(`error: ${msg}`); process.exit(1); }

async function main(): Promise<void> {
  console.log(`Beeper attachments uploader — account=${ARGS.account} concurrency=${ARGS.concurrency} dryRun=${ARGS.dryRun}`);

  // 1) enumerate chats
  console.log(`\n[1/4] fetching all chats for ${ARGS.account}...`);
  let chats = await fetchAllChats(ARGS.account);
  console.log(`  found ${chats.length} chats`);
  if (ARGS.limitChats !== undefined) {
    chats = chats.slice(0, ARGS.limitChats);
    console.log(`  capped at ${chats.length} chats (--limit-chats)`);
  }

  // 2) collect attachment refs (dedupe by mxc_id, keep first occurrence)
  console.log(`\n[2/4] collecting attachment refs from messages...`);
  const byMxc = new Map<string, AttachmentMeta>();
  let scanned = 0;
  for (const c of chats) {
    let atts: AttachmentMeta[];
    try { atts = await fetchAttachmentsForChat(c); }
    catch (e) { console.error(`  ! chat ${c.title ?? c.id}: ${(e as Error).message}`); continue; }
    for (const a of atts) if (!byMxc.has(a.mxc_id)) byMxc.set(a.mxc_id, a);
    scanned += 1;
    if (scanned % 25 === 0 || scanned === chats.length) {
      console.log(`  scanned ${scanned}/${chats.length} chats, unique attachments so far: ${byMxc.size}`);
    }
  }
  const allAttachments = Array.from(byMxc.values());
  console.log(`  total unique attachments: ${allAttachments.length}`);

  // 3) ask Convex which we've already uploaded; merge with local progress
  let toUpload: AttachmentMeta[] = allAttachments;
  const progress = loadProgress(ARGS.account);
  if (!ARGS.refresh) {
    if (!ARGS.dryRun) {
      console.log(`\n[3/4] checking Convex for previously-uploaded attachments...`);
      const allMxc = allAttachments.map((a) => a.mxc_id);
      const knownUploaded = new Set<string>(Object.keys(progress.uploaded));
      const chunk = 200;
      for (let i = 0; i < allMxc.length; i += chunk) {
        const slice = allMxc.slice(i, i + chunk);
        const resp = await convexPost<{ uploaded: { mxc_id: string; convex_storage_id: string }[]; missing: string[] }>(
          ENDPOINTS.discover, { mxc_ids: slice },
        );
        for (const u of resp.uploaded) {
          knownUploaded.add(u.mxc_id);
          progress.uploaded[u.mxc_id] = u.convex_storage_id;
        }
      }
      saveProgress(progress);
      toUpload = allAttachments.filter((a) => !knownUploaded.has(a.mxc_id));
      console.log(`  ${knownUploaded.size} already uploaded, ${toUpload.length} remaining`);
    } else {
      toUpload = allAttachments.filter((a) => !progress.uploaded[a.mxc_id]);
      console.log(`\n[3/4] (dry-run) skipping discover; ${toUpload.length} would be uploaded`);
    }
  } else {
    console.log(`\n[3/4] --refresh: uploading all ${toUpload.length} attachments`);
  }

  if (ARGS.limit !== undefined) toUpload = toUpload.slice(0, ARGS.limit);
  const totalBytes = toUpload.reduce((sum, a) => sum + (a.file_size ?? 0), 0);
  console.log(`  to upload now: ${toUpload.length} (${(totalBytes / (1024 * 1024)).toFixed(1)} MiB est.)`);

  if (ARGS.dryRun || toUpload.length === 0) {
    console.log(`\ndone (${ARGS.dryRun ? "dry-run" : "nothing to do"}).`);
    return;
  }

  // 4) parallel upload with bounded concurrency
  console.log(`\n[4/4] uploading at concurrency=${ARGS.concurrency}...`);
  let done = 0;
  let okCount = 0;
  let failCount = 0;
  let bytes = 0;
  const started = Date.now();

  let cursor = 0;
  async function worker(id: number): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= toUpload.length) return;
      const att = toUpload[idx]!;
      const result = await uploadOne(att);
      if (result.ok) {
        progress.uploaded[att.mxc_id] = result.storageId;
        delete progress.failed[att.mxc_id];
        okCount += 1;
        bytes += att.file_size ?? 0;
      } else {
        progress.failed[att.mxc_id] = result.error;
        failCount += 1;
      }
      done += 1;
      // Save progress every 25 finished attachments so a crash doesn't lose much.
      if (done % 25 === 0 || done === toUpload.length) {
        saveProgress(progress);
        const elapsed = (Date.now() - started) / 1000;
        const rate = done / Math.max(elapsed, 0.001);
        const mbps = bytes / (1024 * 1024) / Math.max(elapsed, 0.001);
        const eta = (toUpload.length - done) / Math.max(rate, 0.001);
        console.log(
          `  [w${id}] done ${done}/${toUpload.length}  ok=${okCount} fail=${failCount}  ` +
          `${(bytes / (1024 * 1024)).toFixed(1)} MiB  ${mbps.toFixed(2)} MiB/s  ` +
          `eta ${eta.toFixed(0)}s`,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: ARGS.concurrency }, (_, i) => worker(i + 1)),
  );

  saveProgress(progress);
  const elapsed = (Date.now() - started) / 1000;
  console.log(
    `\ndone. uploaded=${okCount} failed=${failCount} ` +
    `bytes=${(bytes / (1024 * 1024)).toFixed(1)} MiB elapsed=${elapsed.toFixed(1)}s`,
  );

  if (failCount > 0) {
    console.log(`\nFailed mxc_ids (last error each):`);
    const failed = Object.entries(progress.failed).slice(0, 20);
    for (const [mxc, err] of failed) console.log(`  ${mxc}: ${err}`);
    if (Object.keys(progress.failed).length > failed.length) {
      console.log(`  ... and ${Object.keys(progress.failed).length - failed.length} more`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
