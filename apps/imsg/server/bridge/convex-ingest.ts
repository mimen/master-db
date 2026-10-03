import type { Infer } from "convex/values";
import type {
  CommaAttachmentDoc,
  CommaConversationDoc,
  CommaMessageDoc,
  syncStateDoc,
} from "../../../../convex/schema/comma/validators";
import type { Config } from "../config";

type Fields<T> = Omit<T, "_id" | "_creationTime">;
export type ConversationInput = Omit<Fields<CommaConversationDoc>, "primaryChatGuid" | "chatGuids" | "updatedAt"> & {
  chats: { chatGuid: string; lastMessageAt: number }[];
};
export type MessageRow = Fields<CommaMessageDoc>;
export type AttachmentRow = Fields<CommaAttachmentDoc>;
export type SyncInput = Omit<Fields<Infer<typeof syncStateDoc>>, "updatedAt">;

interface Bodies {
  conversations: { conversations: ConversationInput[] };
  messages: { messages: MessageRow[] };
  attachments: { attachments: AttachmentRow[] };
  sync: SyncInput;
}
interface Results {
  conversations: Record<string, MessageRow["conversationId"]>;
  messages: { written: number; skipped: number };
  attachments: { written: number; skipped: number };
  sync: null;
}

export class ConvexIngest {
  constructor(private config: Pick<Config, "convexSiteUrl" | "commaBridgeSecret">) {}

  async post<K extends keyof Bodies>(kind: K, body: Bodies[K]): Promise<Results[K]> {
    const { convexSiteUrl, commaBridgeSecret } = this.config;
    if (!commaBridgeSecret) throw new Error("Comma bridge disabled, COMMA_BRIDGE_SECRET is unset");
    if (!convexSiteUrl) throw new Error("CONVEX_SITE_URL is unset");
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${convexSiteUrl}/comma/ingest/${kind}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${commaBridgeSecret}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        if (attempt >= 4) throw error;
        await Bun.sleep(250 * 2 ** attempt);
        continue;
      }
      if (response.status >= 500 && attempt < 4) {
        await response.text();
        await Bun.sleep(250 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        const detail = await response.text();
        console.error(`Comma ingest ${kind} HTTP ${response.status}: ${detail}`);
        throw new Error(`Comma ingest ${kind} HTTP ${response.status}`);
      }
      const envelope = await response.json() as { ok: boolean; result: Results[K] };
      if (!envelope.ok) throw new Error(`Comma ingest ${kind} rejected the batch`);
      return envelope.result;
    }
  }
}
