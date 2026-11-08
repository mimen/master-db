import { isAiKind } from "../../../../convex/schema/comma/validators";
import { ConvexIngest, type Bodies, type Results, type MessageRow } from "./convex-ingest";

type Call = { [K in keyof Bodies]: { kind: K; body: Bodies[K] } }[keyof Bodies];

export class FakeIngest extends ConvexIngest {
  readonly calls: Call[] = [];
  fail: keyof Bodies | null = null;
  readonly outboxRows: Results["claim"] = [];
  readonly id = "conversation-test" as MessageRow["conversationId"];

  constructor() { super({ convexSiteUrl: "http://test.invalid", commaBridgeSecret: "test" }); }

  readonly backlog: Results["mediaBacklog"]["items"] = [];
  thread: Results["aiThread"] = { title: "", isGroup: false, participants: [], route: { platform: "imessage", chatGuid: "iMessage;-;+15550000000" }, messages: [],
    bridge: { privateApi: false, emojiReactions: false } };
  sent: Results["aiSentText"] = [];
  attachment: Results["agentAttachment"] = null;
  readonly uploads: Array<{ bytes: number; contentType: string }> = [];

  override async upload(bytes: Uint8Array, contentType: string): Promise<string> {
    this.uploads.push({ bytes: bytes.byteLength, contentType });
    return `storage-${this.uploads.length}`;
  }

  override async post<K extends keyof Bodies>(kind: K, body: Bodies[K]): Promise<Results[K]> {
    this.calls.push({ kind, body } as Call);
    if (kind === this.fail) throw new Error("ingest offline");
    const conversations = kind === "conversations" ? body as Bodies["conversations"] : null;
    const results: Results = {
      account: "account-test" as Results["account"],
      ephemeral: true,
      conversations: Object.fromEntries((conversations?.conversations ?? []).flatMap((row) =>
        row.chats.map((chat) => [chat.chatGuid, this.id]))),
      messages: { written: 1, skipped: 0 },
      attachments: { written: 1, skipped: 0 },
      sync: null,
      suggestions: null,
      unread: { changed: 0, unresolved: 0 },
      scheduled: { upserted: 1, deleted: 0 },
      claim: kind === "claim" ? this.claim(body as Bodies["claim"]) : [],
      complete: true,
      renew: true,
      storage: true,
      photo: true, groupPhoto: true,
      transcript: true,
      mediaBacklog: { items: this.backlog.splice(0), cursor: "done", isDone: true },
      aiThread: this.thread,
      aiSentText: this.sent,
      agentAttachment: this.attachment,
    };
    return results[kind];
  }

  /** Convex's lane filter: a lane takes the oldest of its own rows. */
  private claim({ lane, limit }: Bodies["claim"]): Results["claim"] {
    const taken = this.outboxRows.filter((row) => (row.lane ?? (isAiKind(row.payload.kind) ? "ai" : "imessage")) === lane).slice(0, limit);
    for (const row of taken) this.outboxRows.splice(this.outboxRows.indexOf(row), 1);
    return taken;
  }
}
