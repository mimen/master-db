#!/usr/bin/env bun
/**
 * Sync Beeper Desktop's local-API contents into Convex.
 *
 * Phase A: ingest chats + messages metadata for a single Beeper account
 * (defaults to WhatsApp). Attachment bytes are NOT uploaded — only the
 * `mxc_id` + metadata are stored. The Phase B uploader will fill in
 * convex_storage_id later by walking attachments missing it.
 *
 * Usage:
 *   bun run scripts/sync-beeper.ts                       # WhatsApp full backfill
 *   bun run scripts/sync-beeper.ts --account telegram    # other network
 *   bun run scripts/sync-beeper.ts --since-days 7        # only chats with activity in last N days
 *   bun run scripts/sync-beeper.ts --limit-chats 5       # smoke test
 *
 * Env (in .env.local):
 *   BEEPER_URL                 default http://localhost:23373/v1
 *   BEEPER_ACCESS_TOKEN        required — Beeper Desktop developer token
 *   CONVEX_INGEST_URL          required — https://<deployment>.convex.site/beeper/ingest
 *   BEEPER_INGEST_SECRET       required — shared secret matching the Convex env var
 *
 * Resumability: the script tracks per-chat completion in a local progress
 * file (.beeper-sync-progress.json) alongside the script. Re-runs skip
 * already-completed chats unless --refresh is passed.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------- args & env -------------------------------------

type Args = {
  account: string;
  sinceDays?: number;
  limitChats?: number;
  refresh: boolean;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { account: "whatsapp", refresh: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--account") args.account = argv[++i] ?? args.account;
    else if (a === "--since-days") args.sinceDays = Number(argv[++i]);
    else if (a === "--limit-chats") args.limitChats = Number(argv[++i]);
    else if (a === "--refresh") args.refresh = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") {
      console.log(usage());
      process.exit(0);
    }
  }
  return args;
}

function usage(): string {
  return `Usage: bun run scripts/sync-beeper.ts [--account whatsapp] [--since-days N] [--limit-chats N] [--refresh] [--dry-run]`;
}

const ARGS = parseArgs(Bun.argv.slice(2));

const BEEPER_URL = process.env.BEEPER_URL ?? "http://localhost:23373/v1";
const BEEPER_TOKEN = process.env.BEEPER_ACCESS_TOKEN;
const CONVEX_INGEST_URL = process.env.CONVEX_INGEST_URL;
const INGEST_SECRET = process.env.BEEPER_INGEST_SECRET;

if (!BEEPER_TOKEN) die("BEEPER_ACCESS_TOKEN not set");
if (!ARGS.dryRun && !CONVEX_INGEST_URL) die("CONVEX_INGEST_URL not set");
if (!ARGS.dryRun && !INGEST_SECRET) die("BEEPER_INGEST_SECRET not set");

const PROGRESS_PATH = join(import.meta.dir, ".beeper-sync-progress.json");

// ---------------------------- types ------------------------------------------

interface BeeperListResp<T> {
  items: T[];
  hasMore: boolean;
  oldestCursor: string | null;
  newestCursor: string | null;
}

interface BeeperParticipant {
  id: string;
  phoneNumber?: string;
  fullName?: string;
  isSelf?: boolean;
  isAdmin?: boolean;
  imgURL?: string;
}

interface BeeperChat {
  id: string;
  localChatID?: string;
  accountID: string;
  network: string;
  title?: string;
  description?: string;
  imgURL?: string | null;
  type: string;
  isReadOnly?: boolean;
  participants?: { items: BeeperParticipant[]; hasMore?: boolean; total?: number };
  lastActivity?: string;
  unreadCount?: number;
  isArchived?: boolean;
  isMuted?: boolean;
  isPinned?: boolean;
}

interface BeeperAttachment {
  id: string;          // mxc://...
  type?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  isGif?: boolean;
  isSticker?: boolean;
  size?: { width?: number; height?: number };
  duration?: number;
  srcURL?: string;
}

interface BeeperReaction {
  id?: string;
  participantID?: string;
  reactionKey?: string;
  emoji?: boolean | string;
}

interface BeeperMessage {
  id: string;
  chatID: string;
  accountID: string;
  senderID?: string;
  senderName?: string;
  timestamp?: string;
  sortKey?: string;
  type?: string;
  text?: string;
  isSender?: boolean;
  isHidden?: boolean;
  isDeleted?: boolean;
  mentions?: unknown[];
  attachments?: BeeperAttachment[];
  reactions?: BeeperReaction[];
  linkedMessageID?: string;
}

interface BeeperAccount {
  network: string;
  accountID: string;
  user?: { displayName?: string; phoneNumber?: string };
}

type Progress = {
  account: string;
  done: string[];
  lastUpdated: string;
};

// ---------------------------- Beeper HTTP ------------------------------------

async function beeperGet<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await fetch(`${BEEPER_URL}${path}`, {
        headers: { Authorization: `Bearer ${BEEPER_TOKEN}` },
      });
      if (!res.ok) {
        throw new Error(`Beeper ${res.status} ${res.statusText} for ${path}`);
      }
      return (await res.json()) as T;
    } catch (e) {
      if (attempt === 4) throw e;
      const wait = 250 * 2 ** attempt;
      console.error(`  ! ${e}; retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw new Error("unreachable");
}

async function fetchAccount(accountId: string): Promise<BeeperAccount> {
  const all = await beeperGet<BeeperAccount[]>("/accounts");
  const found = all.find((a) => a.accountID === accountId);
  if (!found) die(`Beeper has no connected account with id "${accountId}"`);
  return found;
}

async function fetchAllChats(accountId: string): Promise<BeeperChat[]> {
  const chats: BeeperChat[] = [];
  let cursor: string | null = null;
  while (true) {
    const qs = new URLSearchParams({ accountIDs: accountId, limit: "200" });
    if (cursor) qs.set("cursor", cursor);
    const data = await beeperGet<BeeperListResp<BeeperChat>>(
      `/chats/search?${qs.toString()}`,
    );
    chats.push(...data.items);
    if (!data.hasMore || !data.oldestCursor) break;
    cursor = data.oldestCursor;
    await sleep(20);
  }
  return chats;
}

async function fetchAllMessages(chatId: string): Promise<BeeperMessage[]> {
  const enc = encodeURIComponent(chatId);
  const msgs: BeeperMessage[] = [];
  let cursor: string | null = null;
  while (true) {
    const qs = new URLSearchParams({ limit: "500" });
    if (cursor) qs.set("cursor", cursor);
    const data = await beeperGet<BeeperListResp<BeeperMessage>>(
      `/chats/${enc}/messages?${qs.toString()}`,
    );
    msgs.push(...data.items);
    if (!data.hasMore || !data.oldestCursor) break;
    cursor = data.oldestCursor;
    await sleep(20);
  }
  // sort oldest -> newest by sortKey (lexicographic on equal length, fallback ts)
  msgs.sort((a, b) => {
    const sa = a.sortKey ?? "";
    const sb = b.sortKey ?? "";
    if (sa.length !== sb.length) return sa.length - sb.length;
    if (sa !== sb) return sa < sb ? -1 : 1;
    return (a.timestamp ?? "").localeCompare(b.timestamp ?? "");
  });
  return msgs;
}

// ---------------------------- shape conversion -------------------------------

/**
 * Convex `v.optional(v.string())` validators accept `undefined` but reject
 * `null`. Beeper returns `null` for many "no value" fields. Drop nulls before
 * serializing so the optional-field semantics match.
 */
function stripNulls<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null) out[k] = v;
  }
  return out as T;
}

function reshapeAccount(a: BeeperAccount): Record<string, unknown> {
  return stripNulls({
    account_id: a.accountID,
    network: a.network,
    display_name: a.user?.displayName,
    phone_number: a.user?.phoneNumber,
    is_active: true,
    raw: JSON.stringify(a),
  });
}

function reshapeChat(c: BeeperChat): Record<string, unknown> {
  const participants = (c.participants?.items ?? []).map((p) =>
    stripNulls({
      id: p.id,
      phone_number: p.phoneNumber,
      full_name: p.fullName,
      is_self: p.isSelf,
      is_admin: p.isAdmin,
      img_url: p.imgURL,
    }),
  );
  return stripNulls({
    account_id: c.accountID,
    network: c.network,
    chat_id: c.id,
    local_chat_id: c.localChatID,
    title: c.title,
    description: c.description,
    type: c.type,
    img_url: c.imgURL,
    participants,
    last_activity: c.lastActivity,
    is_archived: c.isArchived ?? false,
    is_muted: c.isMuted ?? false,
    is_pinned: c.isPinned ?? false,
    is_read_only: c.isReadOnly ?? false,
    unread_count: c.unreadCount ?? 0,
    raw: JSON.stringify(c),
  });
}

function reshapeMessage(m: BeeperMessage): Record<string, unknown> {
  const attachments = (m.attachments ?? []).map((a) =>
    stripNulls({
      mxc_id: a.id,
      type: a.type,
      mime_type: a.mimeType,
      file_name: a.fileName,
      file_size: a.fileSize,
      width: a.size?.width,
      height: a.size?.height,
      duration_ms: a.duration,
      is_gif: a.isGif,
      is_sticker: a.isSticker,
      beeper_src_url: a.srcURL,
    }),
  );
  const reactions = (m.reactions ?? [])
    .filter((r) => r.participantID && r.reactionKey)
    .map((r) => ({
      participant_id: r.participantID as string,
      emoji_or_key: r.reactionKey as string,
    }));
  return stripNulls({
    account_id: m.accountID,
    network: "WhatsApp", // overwritten below from chat context
    chat_id: m.chatID,
    message_id: m.id,
    sort_key: m.sortKey,
    sender_id: m.senderID,
    sender_name: m.senderName,
    is_sender: m.isSender ?? false,
    timestamp: m.timestamp,
    type: m.type,
    text: m.text ?? "",
    reactions,
    attachments,
    reply_to_message_id: m.linkedMessageID,
    is_deleted: m.isDeleted ?? false,
    is_hidden: m.isHidden ?? false,
    raw: JSON.stringify(m),
  });
}

// ---------------------------- Convex POST ------------------------------------

interface IngestPayload {
  accounts?: Record<string, unknown>[];
  chats?: Record<string, unknown>[];
  messages_by_chat?: { chat_id: string; messages: Record<string, unknown>[] }[];
  mark_full_sync_started?: boolean;
  mark_synced?: { account_id: string; sync_type: "full" | "incremental" };
}

async function postIngest(payload: IngestPayload): Promise<void> {
  if (ARGS.dryRun) {
    const sizes = {
      accounts: payload.accounts?.length ?? 0,
      chats: payload.chats?.length ?? 0,
      msgGroups: payload.messages_by_chat?.length ?? 0,
      totalMessages:
        payload.messages_by_chat?.reduce((n, g) => n + g.messages.length, 0) ??
        0,
    };
    console.log(`  [dry-run] would POST ${JSON.stringify(sizes)}`);
    return;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await fetch(CONVEX_INGEST_URL!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${INGEST_SECRET}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Convex ${res.status} ${res.statusText}: ${body}`);
      }
      return;
    } catch (e) {
      if (attempt === 4) throw e;
      const wait = 500 * 2 ** attempt;
      console.error(`  ! ingest failed (${e}); retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
}

// ---------------------------- progress ---------------------------------------

function loadProgress(account: string): Progress {
  if (!existsSync(PROGRESS_PATH)) {
    return { account, done: [], lastUpdated: new Date().toISOString() };
  }
  const all = JSON.parse(readFileSync(PROGRESS_PATH, "utf8")) as Record<
    string,
    Progress
  >;
  return (
    all[account] ?? { account, done: [], lastUpdated: new Date().toISOString() }
  );
}

function saveProgress(p: Progress): void {
  let all: Record<string, Progress> = {};
  if (existsSync(PROGRESS_PATH)) {
    all = JSON.parse(readFileSync(PROGRESS_PATH, "utf8")) as Record<
      string,
      Progress
    >;
  }
  p.lastUpdated = new Date().toISOString();
  all[p.account] = p;
  writeFileSync(PROGRESS_PATH, JSON.stringify(all, null, 2));
}

// ---------------------------- main -------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(
    `Beeper sync — account=${ARGS.account} dryRun=${ARGS.dryRun} refresh=${ARGS.refresh}`,
  );

  // 1) account
  const account = await fetchAccount(ARGS.account);
  console.log(
    `\n[1/3] account: ${account.network} (${account.accountID}) ${account.user?.phoneNumber ?? ""}`,
  );
  await postIngest({
    accounts: [reshapeAccount(account)],
    mark_full_sync_started: true,
  });

  // 2) chats
  console.log(`\n[2/3] fetching all chats for ${ARGS.account}...`);
  let chats = await fetchAllChats(ARGS.account);
  console.log(`  found ${chats.length} chats`);

  if (ARGS.sinceDays !== undefined) {
    const cutoff = Date.now() - ARGS.sinceDays * 86_400_000;
    chats = chats.filter(
      (c) => !c.lastActivity || new Date(c.lastActivity).getTime() >= cutoff,
    );
    console.log(`  filtered to ${chats.length} active in last ${ARGS.sinceDays}d`);
  }
  if (ARGS.limitChats !== undefined) {
    chats = chats.slice(0, ARGS.limitChats);
    console.log(`  capped at ${chats.length} chats (--limit-chats)`);
  }

  // Upsert all chat rows up-front so dashboards see the universe immediately.
  const chatBatchSize = 50;
  for (let i = 0; i < chats.length; i += chatBatchSize) {
    const slice = chats.slice(i, i + chatBatchSize);
    await postIngest({ chats: slice.map(reshapeChat) });
    console.log(`  posted chat rows ${i + 1}-${i + slice.length}/${chats.length}`);
  }

  // 3) messages
  console.log(`\n[3/3] fetching messages...`);
  const progress = loadProgress(ARGS.account);
  const doneSet = new Set(progress.done);

  let totalMessages = 0;
  const started = Date.now();
  for (let i = 0; i < chats.length; i += 1) {
    const c = chats[i]!;
    const tag = `[${i + 1}/${chats.length}] ${c.title ?? "(no title)"} (${c.type})`;
    if (!ARGS.refresh && doneSet.has(c.id)) {
      console.log(`  ${tag} — skip (already done)`);
      continue;
    }
    console.log(`  ${tag}`);

    let messages: BeeperMessage[];
    try {
      messages = await fetchAllMessages(c.id);
    } catch (e) {
      console.error(`    ! fetch failed: ${e}`);
      continue;
    }

    // Post in chunks of 500 messages.
    const network = c.network;
    const chunkSize = 500;
    for (let j = 0; j < messages.length; j += chunkSize) {
      const slice = messages.slice(j, j + chunkSize);
      const payload: IngestPayload = {
        messages_by_chat: [
          {
            chat_id: c.id,
            messages: slice.map((m) => {
              const reshaped = reshapeMessage(m);
              reshaped.network = network;
              return reshaped;
            }),
          },
        ],
      };
      await postIngest(payload);
    }

    totalMessages += messages.length;
    if (!ARGS.dryRun) {
      doneSet.add(c.id);
      saveProgress({
        account: ARGS.account,
        done: Array.from(doneSet),
        lastUpdated: new Date().toISOString(),
      });
    }

    const elapsed = (Date.now() - started) / 1000;
    console.log(
      `    posted ${messages.length} messages (running ${totalMessages}, elapsed ${elapsed.toFixed(1)}s)`,
    );
  }

  // 4) mark synced
  await postIngest({
    mark_synced: { account_id: ARGS.account, sync_type: "full" },
  });

  console.log(
    `\ndone. chats=${chats.length} messages=${totalMessages} elapsed=${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
