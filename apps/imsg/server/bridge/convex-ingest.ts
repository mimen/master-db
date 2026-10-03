import type { Infer } from "convex/values";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { internal } from "../../../../convex/_generated/api";
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

export interface Bodies {
  conversations: { conversations: ConversationInput[] };
  messages: { messages: MessageRow[] };
  attachments: { attachments: AttachmentRow[] };
  sync: SyncInput;
  overlay: FunctionArgs<typeof internal.comma.internal.importOverlay>;
  scheduled: FunctionArgs<typeof internal.comma.internal.replaceScheduled>;
  claim: FunctionArgs<typeof internal.comma.outbox.claimOutbox>;
  complete: FunctionArgs<typeof internal.comma.outbox.completeOutbox>;
  storage: FunctionArgs<typeof internal.comma.internal.setAttachmentStorage>;
  transcript: FunctionArgs<typeof internal.comma.internal.setTranscript>;
  mediaBacklog: FunctionArgs<typeof internal.comma.internal.mediaBacklog>;
}
export interface Results {
  conversations: Record<string, MessageRow["conversationId"]>;
  messages: { written: number; skipped: number };
  attachments: { written: number; skipped: number };
  sync: null;
  overlay: FunctionReturnType<typeof internal.comma.internal.importOverlay>;
  scheduled: FunctionReturnType<typeof internal.comma.internal.replaceScheduled>;
  claim: FunctionReturnType<typeof internal.comma.outbox.claimOutbox>;
  complete: FunctionReturnType<typeof internal.comma.outbox.completeOutbox>;
  storage: boolean;
  transcript: boolean;
  mediaBacklog: FunctionReturnType<typeof internal.comma.internal.mediaBacklog>;
}

export class ConvexIngest {
  constructor(private config: Pick<Config, "convexSiteUrl" | "commaBridgeSecret">) {}

  /** Uploads bytes to Convex file storage and returns the storage id. */
  async upload(bytes: Uint8Array, contentType: string): Promise<string> {
    const { convexSiteUrl, commaBridgeSecret } = this.config;
    if (!convexSiteUrl || !commaBridgeSecret) throw new Error("Comma bridge disabled");
    const issued = await fetch(`${convexSiteUrl}/comma/ingest-upload-url`, {
      method: "POST",
      headers: { Authorization: `Bearer ${commaBridgeSecret}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!issued.ok) throw new Error(`Comma upload URL HTTP ${issued.status}`);
    const { url } = await issued.json() as { url: string };
    const uploaded = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: bytes,
      signal: AbortSignal.timeout(300_000),
    });
    if (!uploaded.ok) throw new Error(`Comma upload HTTP ${uploaded.status}`);
    const { storageId } = await uploaded.json() as { storageId: string };
    return storageId;
  }

  async post<K extends keyof Bodies>(kind: K, body: Bodies[K]): Promise<Results[K]> {
    const { convexSiteUrl, commaBridgeSecret } = this.config;
    if (!commaBridgeSecret) throw new Error("Comma bridge disabled, COMMA_BRIDGE_SECRET is unset");
    if (!convexSiteUrl) throw new Error("CONVEX_SITE_URL is unset");
    // Claiming twice after a lost response would abandon the first batch's leases.
    const retries = kind === "claim" ? 0 : 4;
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
        if (attempt >= retries) throw error;
        await Bun.sleep(250 * 2 ** attempt);
        continue;
      }
      if (response.status >= 500 && attempt < retries) {
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
