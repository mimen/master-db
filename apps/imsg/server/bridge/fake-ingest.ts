import { ConvexIngest, type Bodies, type Results, type MessageRow } from "./convex-ingest";

type Call = { [K in keyof Bodies]: { kind: K; body: Bodies[K] } }[keyof Bodies];

export class FakeIngest extends ConvexIngest {
  readonly calls: Call[] = [];
  fail: keyof Bodies | null = null;
  readonly id = "conversation-test" as MessageRow["conversationId"];

  constructor() { super({ convexSiteUrl: "http://test.invalid", commaBridgeSecret: "test" }); }

  override async post<K extends keyof Bodies>(kind: K, body: Bodies[K]): Promise<Results[K]> {
    this.calls.push({ kind, body } as Call);
    if (kind === this.fail) throw new Error("ingest offline");
    const conversations = kind === "conversations" ? body as Bodies["conversations"] : null;
    const results: Results = {
      conversations: Object.fromEntries((conversations?.conversations ?? []).flatMap((row) =>
        row.chats.map((chat) => [chat.chatGuid, this.id]))),
      messages: { written: 1, skipped: 0 },
      attachments: { written: 1, skipped: 0 },
      sync: null,
      overlay: { states: 1, events: 1, open: 1, unresolved: 0 },
    };
    return results[kind];
  }
}
