import { createHash } from "node:crypto";
import type { BBChat, BBMessage } from "../bb-types";
import type { BlueBubbles, Result } from "../bluebubbles";
import type { OverlayDb } from "../db";
import type { NameSource } from "../name-resolver";
import type { AttachmentRow, ConvexIngest, MessageRow } from "./convex-ingest";
import { sourceVersion, toAttachmentRows, toConversationInputs, toMessageRow } from "./mapper";
import { RetryWork } from "./retry";

export function bbValue<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`BlueBubbles: ${result.error}`);
  return result.value;
}

export function batches<T>(rows: T[]): T[][] {
  const parts: T[][] = [];
  for (let i = 0; i < rows.length; i += 200) parts.push(rows.slice(i, i + 200));
  return parts;
}

export class MessageWriter {
  readonly conversationIds = new Map<string, MessageRow["conversationId"]>();
  private chats = new Map<string, BBChat>();
  private serial: Promise<unknown> = Promise.resolve();

  constructor(readonly deps: {
    bb: BlueBubbles;
    db: OverlayDb;
    ingest: Pick<ConvexIngest, "post">;
    names?: NameSource;
  }) {}

  exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.serial.then(work, work);
    this.serial = next;
    // Callers own retry; a failed run must not leave an unhandled rejection.
    void next.catch(() => {});
    return next;
  }

  async refreshChats(): Promise<void> {
    const chats = new Map<string, BBChat>();
    for (let offset = 0; ; offset += 1000) {
      const page = bbValue(await this.deps.bb.queryChats(1000, offset));
      for (const chat of page) chats.set(chat.guid, chat);
      if (page.length < 1000) break;
    }
    this.chats = chats;
    await this.upsertChats();
  }

  private async upsertChats(): Promise<void> {
    for (const batch of batches(toConversationInputs([...this.chats.values()], this.deps.names))) {
      const resolved = await this.deps.ingest.post("conversations", { conversations: batch });
      for (const [guid, id] of Object.entries(resolved)) this.conversationIds.set(guid, id);
    }
  }

  async ensureChat(chatGuid: string): Promise<void> {
    if (this.conversationIds.has(chatGuid)) return;
    this.chats.set(chatGuid, bbValue(await this.deps.bb.getChat(chatGuid)));
    await this.upsertChats();
  }

  async postMessages(raw: BBMessage[]): Promise<void> {
    const messages: MessageRow[] = [];
    const attachments: AttachmentRow[] = [];
    for (const message of raw) {
      const base = sourceVersion(message);
      const chatGuid = message.chats?.[0]?.guid;
      if (!chatGuid) {
        console.warn(`comma bridge: skipping orphan ${message.guid}`);
        continue;
      }
      await this.ensureChat(chatGuid);
      const id = this.conversationIds.get(chatGuid);
      if (!id) throw new Error(`Unresolved conversation ${chatGuid}`);
      const row = toMessageRow(message, id, 0, this.deps.names);
      const files = toAttachmentRows(message, id, 0);
      const fingerprint = createHash("sha256").update(JSON.stringify({ row, files })).digest("hex");
      const version = this.deps.db.bridgeVersion(message.guid, fingerprint, base);
      messages.push({ ...row, sourceVersion: version });
      attachments.push(...files.map((file) => ({ ...file, sourceVersion: version })));
    }
    for (const batch of batches(messages)) await this.deps.ingest.post("messages", { messages: batch });
    for (const batch of batches(attachments)) await this.deps.ingest.post("attachments", { attachments: batch });
  }
}

export class LiveBridge {
  private messages = new Map<string, BBMessage>();
  private refreshRevision = 1;
  private refreshedRevision = 0;
  private unsubscribe: () => void;
  private work: RetryWork;
  lastEventAt: number | null = null;

  constructor(readonly writer: MessageWriter, private now = Date.now) {
    this.work = new RetryWork("live", () => writer.exclusive(async () => {
      const revision = this.refreshRevision;
      if (revision !== this.refreshedRevision) {
        await writer.refreshChats();
        this.refreshedRevision = revision;
      }
      const queued = [...this.messages.values()];
      const hydrated: BBMessage[] = [];
      for (const message of queued) {
        const fetched = bbValue(await writer.deps.bb.messageWithReactions(message.guid))
          .find((row) => row.guid === message.guid);
        if (!fetched) throw new Error(`Message ${message.guid} not yet readable`);
        hydrated.push({ ...fetched, ...message });
      }
      await writer.postMessages(hydrated);
      if (queued.length) await writer.deps.ingest.post("sync", { key: "continuous", lastEventAt: this.lastEventAt ?? undefined });
      for (const message of queued) {
        if (this.messages.get(message.guid) === message) this.messages.delete(message.guid);
      }
    }));
    this.unsubscribe = writer.deps.bb.onEvent((event) => {
      if (event.kind === "new-message" || event.kind === "updated-message" || event.kind === "message-send-error") {
        const message = event.kind === "message-send-error"
          ? { ...event.message, error: event.message.error || 1 } : event.message;
        if (event.kind === "message-send-error") console.error(`comma bridge send error: ${message.guid}, ${message.error}`);
        this.lastEventAt = this.now();
        this.messages.set(message.guid, { ...this.messages.get(message.guid), ...message });
        this.work.request(100);
      } else if (event.kind === "group-changed") {
        this.lastEventAt = this.now();
        this.refreshRevision++;
        this.work.request(100);
      }
    });
    this.work.request();
  }

  get pending(): number { return this.messages.size + this.work.pending; }
  flush(): Promise<void> { return this.work.flush(); }
  stop(): void { this.unsubscribe(); this.work.stop(); }
}
