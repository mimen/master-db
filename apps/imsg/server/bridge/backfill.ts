import { Database } from "bun:sqlite";
import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { BBChat, BBMessage } from "../bb-types";
import { BlueBubblesClient, type BlueBubbles, type Result } from "../bluebubbles";
import { loadConfig, type Config } from "../config";
import { ContactBook } from "../contacts";
import { ConvexIngest, type AttachmentRow, type MessageRow } from "./convex-ingest";
import { sourceVersion, toAttachmentRows, toConversationInputs, toMessageRow } from "./mapper";

interface Counts {
  conversations: number;
  messages: number;
  attachments: number;
  orphans: number;
  duplicates: number;
}
interface Checkpoint {
  siteUrl: string;
  bbUrl: string;
  cursor: number;
  counts: Counts;
}
interface InventoryRow { originalROWID: number; guid: string }
interface Options {
  config?: Config;
  bb?: BlueBubbles;
  ingest?: ConvexIngest;
  checkpointPath?: string;
  chatDbPath?: string;
}

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`BlueBubbles backfill failed: ${result.error}`);
  return result.value;
}
function batches<T>(rows: T[]): T[][] {
  const parts: T[][] = [];
  for (let i = 0; i < rows.length; i += 200) parts.push(rows.slice(i, i + 200));
  return parts;
}

export async function runBackfill(options: Options = {}) {
  const config = options.config ?? loadConfig();
  if (!config.commaBridgeSecret) {
    console.log("Comma backfill disabled, COMMA_BRIDGE_SECRET is unset");
    return null;
  }
  if (!config.convexSiteUrl) throw new Error("CONVEX_SITE_URL is unset");
  const started = performance.now();
  const bb = options.bb ?? new BlueBubblesClient(config.bbUrl, config.bbPassword);
  const ingest = options.ingest ?? new ConvexIngest(config);
  const checkpointPath = options.checkpointPath ?? `${config.dbPath}.comma-backfill.json`;
  let state: Checkpoint = { siteUrl: config.convexSiteUrl, bbUrl: config.bbUrl, cursor: 0,
    counts: { conversations: 0, messages: 0, attachments: 0, orphans: 0, duplicates: 0 } };
  const file = Bun.file(checkpointPath);
  if (await file.exists()) {
    const saved = await file.json() as Checkpoint;
    if (saved.siteUrl !== state.siteUrl || saved.bbUrl !== state.bbUrl ||
        !Number.isSafeInteger(saved.cursor) || saved.cursor < 0 || !saved.counts ||
        Object.keys(state.counts).some((key) => !Number.isSafeInteger(saved.counts[key as keyof Counts]) || saved.counts[key as keyof Counts] < 0)) {
      throw new Error(`Invalid or wrong-target backfill checkpoint ${checkpointPath}`);
    }
    state = saved;
  }
  const counts = state.counts;
  async function checkpoint(cursor: number) {
    await ingest.post("sync", { key: "backfill", cursor: String(cursor), counts: { ...counts }, lastReconcileAt: Date.now() });
    await mkdir(dirname(checkpointPath), { recursive: true });
    await Bun.write(`${checkpointPath}.tmp`, JSON.stringify({ ...state, cursor }));
    await rename(`${checkpointPath}.tmp`, checkpointPath);
    state.cursor = cursor;
  }
  let inventory: InventoryRow[] | null = null;
  const chatDbPath = options.chatDbPath ?? Bun.env.CHATDB_PATH ?? `${Bun.env.HOME}/Library/Messages/chat.db`;
  let chatDb: Database | undefined;
  try {
    chatDb = new Database(chatDbPath, { readonly: true, strict: true });
    inventory = chatDb.query<InventoryRow, []>("SELECT ROWID AS originalROWID, guid FROM message ORDER BY ROWID").all();
    console.log(`chat.db readable, ${inventory.length} messages`);
  } catch (error) {
    console.warn(`chat.db unavailable, using BlueBubbles only. No orphan inventory. ${String(error)}`);
  } finally { chatDb?.close(); }
  const latest = inventory ? null : value(await bb.queryMessages({ limit: 1, offset: 0, highestRowid: true }))[0];
  if (latest) sourceVersion(latest);
  const maxRowid = inventory?.at(-1)?.originalROWID ?? latest?.originalROWID ?? 0;
  if (state.cursor > maxRowid) throw new Error("Backfill cursor exceeds source ROWID, use a fresh checkpoint after a source reset");
  const contacts = new ContactBook(bb);
  await contacts.refresh();
  const chats = new Map<string, BBChat>();
  for (let offset = 0; ; offset += 1000) {
    const page = value(await bb.queryChats(1000, offset));
    for (const chat of page) chats.set(chat.guid, chat);
    if (page.length < 1000) break;
  }
  const conversationIds = new Map<string, MessageRow["conversationId"]>();
  async function upsertChats() {
    const inputs = toConversationInputs([...chats.values()], contacts);
    counts.conversations = inputs.length;
    for (const batch of batches(inputs)) {
      const resolved = await ingest.post("conversations", { conversations: batch });
      for (const [guid, id] of Object.entries(resolved)) conversationIds.set(guid, id);
    }
  }
  await upsertChats();
  console.log(`Backfill ${counts.conversations} conversations, ROWID ${state.cursor} to ${maxRowid}`);
  for (let after = state.cursor; after < maxRowid; after += 1000) {
    const through = Math.min(after + 1000, maxRowid);
    const unique = new Map<string, BBMessage>();
    for (let offset = 0; ; offset += 2000) {
      const page = value(await bb.queryMessages({ limit: 2000, offset, rowidRange: { after, through } }));
      for (const message of page) {
        sourceVersion(message);
        if (message.originalROWID! <= after || message.originalROWID! > through) throw new Error("BlueBubbles returned a message outside the ROWID range");
        if (unique.has(message.guid)) counts.duplicates++;
        unique.set(message.guid, message);
      }
      if (page.length < 2000) break;
    }
    for (const row of inventory ?? []) {
      if (row.originalROWID <= after || row.originalROWID > through || unique.has(row.guid)) continue;
      const fetched = value(await bb.messageWithReactions(row.guid)).find((message) => message.guid === row.guid);
      if (!fetched) throw new Error(`BlueBubbles omitted inventory message ${row.guid}`);
      unique.set(row.guid, { ...fetched, originalROWID: row.originalROWID });
    }
    const messages: MessageRow[] = [];
    const attachments: AttachmentRow[] = [];
    for (const message of unique.values()) {
      const chat = message.chats?.[0];
      if (chat && !conversationIds.has(chat.guid)) {
        chats.set(chat.guid, value(await bb.getChat(chat.guid)));
        await upsertChats();
      }
      const id = chat ? conversationIds.get(chat.guid) : undefined;
      if (!id) {
        counts.orphans++;
        console.log(`Skipping orphan ${message.guid} ROWID ${message.originalROWID ?? "unknown"}`);
        continue;
      }
      const version = sourceVersion(message);
      messages.push(toMessageRow(message, id, version, contacts));
      attachments.push(...toAttachmentRows(message, id, version));
    }
    for (const batch of batches(messages)) await ingest.post("messages", { messages: batch });
    for (const batch of batches(attachments)) await ingest.post("attachments", { attachments: batch });
    counts.messages += messages.length;
    counts.attachments += attachments.length;
    await checkpoint(through);
    console.log(`ROWID ${through}/${maxRowid}, messages ${counts.messages}, attachments ${counts.attachments}, orphans ${counts.orphans}`);
  }
  await checkpoint(maxRowid);
  return { ...counts, cursor: maxRowid, durationMs: Math.round(performance.now() - started), chatDbMessages: inventory?.length ?? null };
}
