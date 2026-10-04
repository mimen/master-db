import type { GenericId } from "convex/values";
import type { BBChat } from "../bb-types";
import type { BlueBubbles } from "../bluebubbles";
import type { OverlayDb } from "../db";
import type { ConvexIngest } from "./convex-ingest";
import { toConversationInputs } from "./mapper";
import { RetryWork } from "./retry";

/** Mirrors group photos after conversation ingest; upload receipts survive retries and restarts. */
export class GroupPhotoMirror {
  private chats = new Map<string, BBChat>();
  private work: RetryWork;
  private stopped = false;

  constructor(bb: Pick<BlueBubbles, "downloadAttachment">, db: OverlayDb, ingest: Pick<ConvexIngest, "post" | "upload">) {
    this.work = new RetryWork("group photos", async () => {
      for (const [key, chat] of this.chats) {
        if (this.stopped) break;
        const guid = chat.properties?.[0]?.groupPhotoGuid || null;
        const receiptKey = `group:${key}`;
        let prior = db.getBridgePhoto(receiptKey);
        if (!guid) {
          if (prior?.hash && !await ingest.post("groupPhoto", { chatGuid: chat.guid, guid: null })) {
            throw new Error(`Group photo conversation missing: ${chat.guid}`);
          }
          if (prior?.hash) db.setBridgePhoto(receiptKey, "", "", true);
        } else {
          if (prior?.hash !== guid) {
            const download = await bb.downloadAttachment(guid);
            if (!download.ok || !download.body) throw new Error(`Group photo download failed: ${guid}`);
            const bytes = new Uint8Array(await new Response(download.body).arrayBuffer());
            const contentType = bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png"
              : new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp" ? "image/heic" : "image/jpeg";
            const storageId = await ingest.upload(bytes, contentType);
            db.setBridgePhoto(receiptKey, guid, storageId, false);
            prior = { hash: guid, storageId, matched: 0 };
          }
          if (!prior.matched) {
            if (!await ingest.post("groupPhoto", { chatGuid: chat.guid, guid,
              storageId: prior.storageId as GenericId<"_storage"> })) throw new Error(`Group photo conversation missing: ${chat.guid}`);
            db.setBridgePhoto(receiptKey, guid, prior.storageId, true);
          }
        }
        if (this.chats.get(key) === chat) this.chats.delete(key);
      }
    });
  }

  observe(chats: BBChat[]): void {
    for (const row of toConversationInputs(chats)) {
      if (!row.isGroup) continue;
      const chat = chats.find((chat) => chat.guid === row.chats[0].chatGuid);
      if (chat) this.chats.set(row.conversationKey, chat);
    }
    this.work.request();
  }
  flush(): Promise<void> { return this.work.flush(); }
  stop(): void { this.stopped = true; this.work.stop(); }
}
