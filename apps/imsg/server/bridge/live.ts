import { createHash } from "node:crypto";
import type { BBChat, BBMessage } from "../bb-types";
import type { BlueBubbles, Result } from "../bluebubbles";
import type { OverlayDb } from "../db";
import type { NameSource } from "../name-resolver";
import type { AttachmentRow, ConvexIngest, MessageRow } from "./convex-ingest";
import { sourceVersion, toAttachmentRows, toConversationInputs, toMessageRow } from "./mapper";
import { PresenceBridge } from "./presence";
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
  private outboxClientKeys = new Set<string>();

  rememberOutboxSend(clientKey: string): void {
    this.outboxClientKeys.add(clientKey);
    // ponytail: retain 1000 recent sends; persist correlations if late echoes exceed this window.
    if (this.outboxClientKeys.size > 1000) {
      const oldest = this.outboxClientKeys.values().next().value;
      if (oldest !== undefined) this.outboxClientKeys.delete(oldest);
    }
  }

  async resolveConversation(id: MessageRow["conversationId"]): Promise<string> {
    const known = () => toConversationInputs([...this.chats.values()], this.deps.names)
      .find((row) => row.chats.some((chat) => this.conversationIds.get(chat.chatGuid) === id))?.chats[0]?.chatGuid;
    let guid = known();
    if (!guid) {
      await this.exclusive(() => this.refreshChats());
      guid = known();
    }
    if (!guid) throw new Error(`Unresolved conversation ${id}`);
    return guid;
  }
  private serial: Promise<unknown> = Promise.resolve();

  constructor(readonly deps: {
    bb: BlueBubbles;
    db: OverlayDb;
    ingest: Pick<ConvexIngest, "post">;
    names?: NameSource;
  }) {}

  /** Set by the bridge so every mirrored attachment reaches the media upload queue. */
  onAttachments: ((rows: AttachmentRow[], createdAt: number) => void) | null = null;
  onChats: ((chats: BBChat[]) => void) | null = null;

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

  private posted = new Map<string, string>();
  private postedSince = 0;

  private async upsertChats(): Promise<void> {
    // Reconcile re-reads every chat every two minutes. Re-posting all ~1,000 took about ten seconds
    // of ingest, and live messages waited behind it in the shared queue, so only changed rows go.
    // ponytail: an hourly full post refreshes ids a server-side merge may have moved; restart also does.
    if (Date.now() - this.postedSince > 60 * 60_000) {
      this.posted.clear();
      this.postedSince = Date.now();
    }
    const changed = toConversationInputs([...this.chats.values()], this.deps.names)
      .map((row) => ({ row, json: JSON.stringify(row) }))
      .filter(({ row, json }) => this.posted.get(row.conversationKey) !== json ||
        row.chats.some((chat) => !this.conversationIds.has(chat.chatGuid)));
    for (const batch of batches(changed)) {
      const resolved = await this.deps.ingest.post("conversations", { conversations: batch.map(({ row }) => row) });
      for (const [guid, id] of Object.entries(resolved)) this.conversationIds.set(guid, id);
      for (const { row, json } of batch) this.posted.set(row.conversationKey, json);
    }
    this.onChats?.([...this.chats.values()]);
  }

  async ensureChat(chatGuid: string): Promise<void> {
    if (this.conversationIds.has(chatGuid)) return;
    this.chats.set(chatGuid, bbValue(await this.deps.bb.getChat(chatGuid)));
    await this.upsertChats();
  }

  async postMessages(raw: BBMessage[]): Promise<MessageRow[]> {
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
      if (message.tempGuid && this.outboxClientKeys.has(message.tempGuid)) row.clientKey = message.tempGuid;
      const files = toAttachmentRows(message, id, 0);
      const fingerprint = createHash("sha256").update(JSON.stringify({ row, files })).digest("hex");
      const version = this.deps.db.bridgeVersion(message.guid, fingerprint, base);
      messages.push({ ...row, sourceVersion: version });
      attachments.push(...files.map((file) => ({ ...file, sourceVersion: version })));
    }
    for (const batch of batches(messages)) await this.deps.ingest.post("messages", { messages: batch });
    for (const batch of batches(attachments)) await this.deps.ingest.post("attachments", { attachments: batch });
    if (attachments.length) this.onAttachments?.(attachments, Date.now());
    return messages;
  }
}

export class LiveBridge {
  private messages = new Map<string, BBMessage>();
  readonly presence: PresenceBridge;
  private refreshRevision = 1;
  private refreshedRevision = 0;
  private unsubscribe: () => void;
  private work: RetryWork;
  lastEventAt: number | null = null;

  constructor(readonly writer: MessageWriter, private now = Date.now, onMessages?: (rows: MessageRow[]) => void) {
    this.presence = new PresenceBridge(writer, now);
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
      const rows = await writer.postMessages(hydrated);
      if (queued.length) await writer.deps.ingest.post("sync", { key: "continuous", lastEventAt: this.lastEventAt ?? undefined });
      onMessages?.(rows);
      for (const message of queued) {
        if (this.messages.get(message.guid) === message) this.messages.delete(message.guid);
      }
    }));
    this.unsubscribe = writer.deps.bb.onEvent((event) => {
      this.presence.observe(event);
      if (event.kind === "new-message" || event.kind === "updated-message" || event.kind === "message-send-error") {
        const message = event.kind === "message-send-error"
          ? { ...event.message, error: event.message.error || 1 } : event.message;
        if (event.kind === "message-send-error") console.error(`comma bridge send error: ${message.guid}, ${message.error}`);
        this.lastEventAt = this.now();
        this.messages.set(message.guid, { ...this.messages.get(message.guid), ...message });
        this.work.request(100);
      } else if (event.kind === "group-changed" || event.kind === "stream-connected") {
        this.lastEventAt = this.now();
        this.refreshRevision++;
        this.work.request(100);
      }
    });
    this.work.request();
  }

  get pending(): number { return this.messages.size + this.work.pending + this.presence.pending; }
  async flush(): Promise<void> { await this.work.flush(); await this.presence.flush(); }
  stop(): void { this.unsubscribe(); this.work.stop(); this.presence.stop(); }
}
