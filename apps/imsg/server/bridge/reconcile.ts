import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import type { BBMessage } from "../bb-types";
import type { Config } from "../config";
import { sourceVersion } from "./mapper";
import { bbValue, MessageWriter } from "./live";
import { RetryWork } from "./retry";

type InventoryRow = { originalROWID: number; guid: string };

export class ReconcileBridge {
  cursor: number;
  lastReconcileAt: number | null = null;
  private target: string;
  private chatDb: Database | null = null;
  private work: RetryWork;
  private timer: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;

  constructor(readonly writer: MessageWriter, config: Pick<Config, "dbPath" | "bbUrl" | "convexSiteUrl">,
    options: { chatDbPath?: string; now?: () => number } = {}) {
    this.target = `${config.convexSiteUrl}|${config.bbUrl}`;
    this.cursor = writer.deps.db.getBridgeCursor(this.target) ?? 0;
    const checkpointPath = `${config.dbPath}.comma-backfill.json`;
    if (!this.cursor && existsSync(checkpointPath)) {
      const saved: unknown = JSON.parse(readFileSync(checkpointPath, "utf8"));
      if (!saved || typeof saved !== "object" || !("cursor" in saved) || typeof saved.cursor !== "number" ||
          !Number.isSafeInteger(saved.cursor) || saved.cursor < 0 ||
          !("siteUrl" in saved) || saved.siteUrl !== config.convexSiteUrl ||
          !("bbUrl" in saved) || saved.bbUrl !== config.bbUrl) throw new Error("Invalid or wrong-target backfill checkpoint");
      this.cursor = saved.cursor;
    }
    try {
      this.chatDb = new Database(options.chatDbPath ?? Bun.env.CHATDB_PATH ?? `${Bun.env.HOME}/Library/Messages/chat.db`, { readonly: true });
      this.chatDb.query("SELECT ROWID FROM message LIMIT 1").get();
      console.log("comma bridge: chat.db readable");
    } catch (error) {
      this.chatDb?.close();
      this.chatDb = null;
      console.warn(`comma bridge: chat.db unavailable, BlueBubbles only. ${String(error)}`);
    }
    const now = options.now ?? Date.now;
    this.work = new RetryWork("reconcile", () => writer.exclusive(async () => {
      await writer.refreshChats();
      const inventory = this.chatDb?.query<InventoryRow, [number]>(
        "SELECT ROWID AS originalROWID, guid FROM message WHERE ROWID > ? ORDER BY ROWID",
      ).all(this.cursor);
      const latest = bbValue(await writer.deps.bb.queryMessages({ limit: 1, offset: 0, highestRowid: true }))[0];
      if (latest) sourceVersion(latest);
      const max = this.chatDb
        ? this.chatDb.query<{ rowid: number }, []>("SELECT COALESCE(MAX(ROWID), 0) AS rowid FROM message").get()!.rowid
        : latest?.originalROWID ?? 0;
      if (max < this.cursor) throw new Error("Source ROWID reset, refusing to move cursor backwards");
      for (let after = this.cursor; after < max; after += 1000) {
        const through = Math.min(after + 1000, max);
        const unique = new Map<string, BBMessage>();
        for (let offset = 0; ; offset += 1000) {
          const page = bbValue(await writer.deps.bb.queryMessages({ limit: 1000, offset, rowidRange: { after, through } }));
          for (const message of page) {
            sourceVersion(message);
            if (message.originalROWID! <= after || message.originalROWID! > through) throw new Error("Message outside reconciliation ROWID range");
            unique.set(message.guid, message);
          }
          if (page.length < 1000) break;
        }
        for (const row of inventory ?? []) {
          if (row.originalROWID <= after || row.originalROWID > through || unique.has(row.guid)) continue;
          const fetched = bbValue(await writer.deps.bb.messageWithReactions(row.guid)).find((message) => message.guid === row.guid);
          if (!fetched) throw new Error(`Missing inventory message ${row.guid}`);
          unique.set(row.guid, { ...fetched, originalROWID: row.originalROWID });
        }
        await writer.postMessages([...unique.values()]);
        await this.checkpoint(through);
      }
      // Bound ROWIDs as well as dates so arrivals cannot shift offset pages mid-scan.
      const afterDate = now() - 24 * 60 * 60_000 - 1;
      for (let offset = 0; ; offset += 1000) {
        const page = bbValue(await writer.deps.bb.queryMessages({ limit: 1000, offset,
          rowidRange: { after: 0, through: max }, dateCreatedAfter: afterDate }));
        await writer.postMessages([...new Map(page.map((row) => [row.guid, row])).values()]);
        if (page.length < 1000) break;
      }
      const at = now();
      await writer.deps.ingest.post("sync", { key: "continuous", cursor: String(this.cursor), lastReconcileAt: at });
      this.lastReconcileAt = at;
    }));
    let connected = false;
    this.unsubscribe = writer.deps.bb.onEvent((event) => {
      if (event.kind === "chat-read-status-changed") this.work.request();
      if (event.kind !== "stream-connected") return;
      if (connected) this.work.request();
      connected = true;
    });
    this.timer = setInterval(() => this.work.request(), 2 * 60_000);
    this.timer.unref();
    this.work.request();
  }

  private async checkpoint(cursor: number): Promise<void> {
    await this.writer.deps.ingest.post("sync", { key: "continuous", cursor: String(cursor) });
    this.writer.deps.db.setBridgeCursor(this.target, cursor);
    this.cursor = cursor;
  }

  get pending(): number { return this.work.pending; }
  request(): void { this.work.request(); }
  flush(): Promise<void> { return this.work.flush(); }
  stop(): void {
    this.unsubscribe();
    clearInterval(this.timer);
    this.work.stop();
    void this.work.flush().then(() => { this.chatDb?.close(); this.chatDb = null; });
  }
}
