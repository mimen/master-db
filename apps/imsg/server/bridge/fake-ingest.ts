import { ConvexIngest, type Bodies, type Results, type MessageRow } from "./convex-ingest";

type Call = { [K in keyof Bodies]: { kind: K; body: Bodies[K] } }[keyof Bodies];

export class FakeIngest extends ConvexIngest {
  readonly calls: Call[] = [];
  fail: keyof Bodies | null = null;
  readonly outboxRows: Results["claim"] = [];
  readonly id = "conversation-test" as MessageRow["conversationId"];

  constructor() { super({ convexSiteUrl: "http://test.invalid", commaBridgeSecret: "test" }); }

  readonly backlog: Results["mediaBacklog"]["items"] = [];
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
      ephemeral: true,
      conversations: Object.fromEntries((conversations?.conversations ?? []).flatMap((row) =>
        row.chats.map((chat) => [chat.chatGuid, this.id]))),
      messages: { written: 1, skipped: 0 },
      attachments: { written: 1, skipped: 0 },
      sync: null,
      suggestions: null,
      overlay: { states: 1, events: 1, open: 1, unresolved: 0 },
      scheduled: { upserted: 1, deleted: 0 },
      claim: kind === "claim" ? this.outboxRows.splice(0, (body as Bodies["claim"]).limit) : [],
      complete: true,
      renew: true,
      storage: true,
      photo: true, groupPhoto: true,
      transcript: true,
      mediaBacklog: { items: this.backlog.splice(0), cursor: "done", isDone: true },
    };
    return results[kind];
  }
}
