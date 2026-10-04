import type { BlueBubbles } from "../bluebubbles";
import type { OverlayDb } from "../db";
import { canThumbnail, thumbnailAttachment } from "../thumbnail";
import { transcodeAttachment } from "../transcode";
import type { AttachmentRow, ConvexIngest, Results } from "./convex-ingest";
import { RetryWork } from "./retry";
import { subscribeTranscripts } from "../whisper";
import type { TranscriptState } from "../../shared/types";
import { postMedia } from "./commands/media";

/** GIFs keep their animation, so a small one is uploaded whole as its own thumbnail. */
const GIF_THUMB_LIMIT = 2 * 1024 * 1024;
const BATCH = 5;

/**
 * Uploads attachment media from the Mini to Convex file storage: every queued
 * thumbnail first, newest first, then originals. One upload at a time with a
 * pause between, so live traffic on the Mini's link isn't starved. Videos have
 * no thumbnail yet and upload only as originals.
 */
export class MediaWorker {
  private work: RetryWork;
  private stopped = false;
  private transcriptWork: RetryWork;
  private unsubscribeTranscripts: () => void;
  private transcripts = new Map<string, TranscriptState>();
  uploadedToday = 0;
  lastError: string | null = null;

  constructor(private deps: {
    bb: Pick<BlueBubbles, "downloadAttachment">;
    db: OverlayDb;
    ingest: Pick<ConvexIngest, "post" | "upload">;
    pauseMs?: number;
    isBusy?: () => boolean;
  }) {
    this.work = new RetryWork("media", () => this.drain());
    this.transcriptWork = new RetryWork("transcripts", async () => {
      let failure: Error | undefined;
      for (const [attachmentGuid, transcript] of this.transcripts) {
        try {
          const found = await postMedia(this.deps.ingest, { kind: "transcript", attachmentGuid, transcript });
          if (!found) throw new Error(`Attachment ${attachmentGuid} is not mirrored yet`);
          if (this.transcripts.get(attachmentGuid) === transcript) this.transcripts.delete(attachmentGuid);
        } catch (error) {
          failure ??= error instanceof Error ? error : new Error(String(error));
        }
      }
      if (failure) throw failure;
    });
    this.unsubscribeTranscripts = subscribeTranscripts((cache, guid, state) => {
      if (cache !== this.deps.db) return;
      this.transcripts.set(guid, state);
      this.transcriptWork.request();
    });
  }

  /** Queue on-disk attachments as the bridge mirrors them. */
  enqueue(rows: Pick<AttachmentRow, "guid" | "mimeType" | "filename" | "isOnDisk" | "hideAttachment">[], createdAt: number): void {
    const items = rows
      .filter((row) => row.isOnDisk && !row.hideAttachment)
      .map((row) => ({ guid: row.guid, mimeType: row.mimeType ?? null, filename: row.filename ?? null, createdAt }));
    if (!items.length) return;
    this.deps.db.enqueueMedia(items);
    this.work.request();
  }

  /** Queues attachments mirrored before the worker existed (the initial backfill). Idempotent. */
  async seedFromConvex(): Promise<void> {
    let cursor: string | null = null;
    for (;;) {
      const page: Results["mediaBacklog"] = await this.deps.ingest.post("mediaBacklog", { cursor, limit: 500 });
      this.deps.db.enqueueMedia(page.items.map((item) => ({
        guid: item.guid, mimeType: item.mimeType ?? null, filename: item.filename ?? null, createdAt: item.createdAt,
      })));
      if (page.isDone) break;
      cursor = page.cursor;
    }
    this.work.request();
  }

  /** One-time copy of transcripts Whisper already produced. */
  async copyTranscripts(): Promise<void> {
    for (const { attachmentGuid, text } of this.deps.db.allTranscripts()) {
      await this.deps.ingest.post("transcript", { attachmentGuid, transcript: text });
    }
  }

  start(): void { this.work.request(); }
  async flush(): Promise<void> { await Promise.all([this.work.flush(), this.transcriptWork.flush()]); }
  counts(): { thumbsPending: number; originalsPending: number } { return this.deps.db.mediaCounts(); }

  private async drain(): Promise<void> {
    for (const stage of ["thumb", "original"] as const) {
      while (!this.stopped) {
        // Originals wait for the thumbnail backlog and yield to live traffic.
        if (stage === "original" && (this.counts().thumbsPending > 0 || this.deps.isBusy?.())) return;
        const items = this.deps.db.nextMedia(stage, BATCH);
        if (!items.length) break;
        for (const item of items) {
          if (this.stopped) return;
          try {
            await this.uploadOne(stage, item);
            this.deps.db.markMedia(item.guid, stage);
            this.uploadedToday++;
          } catch (error) {
            this.lastError = String(error);
            this.deps.db.markMedia(item.guid, stage, this.lastError);
          }
          await Bun.sleep(this.deps.pauseMs ?? 250);
        }
      }
    }
  }

  private async uploadOne(
    stage: "thumb" | "original",
    item: { guid: string; mimeType: string | null; filename: string | null },
  ): Promise<void> {
    const { bb, ingest } = this.deps;
    const download = () => bb.downloadAttachment(item.guid);
    if (stage === "thumb") {
      if (item.mimeType === "image/gif") {
        const response = await download();
        const bytes = new Uint8Array(await response.arrayBuffer());
        // A large GIF has no thumbnail; it shows from its original once that uploads.
        if (!response.ok || bytes.byteLength > GIF_THUMB_LIMIT) return;
        const storageId = await ingest.upload(bytes, "image/gif");
        await ingest.post("storage", { guid: item.guid, thumbStorageId: storageId as never });
        return;
      }
      if (!canThumbnail(item.mimeType, item.filename)) return;
      const thumb = await thumbnailAttachment(item.guid, 520, download);
      if (!thumb.ok) throw new Error(thumb.reason);
      const storageId = await ingest.upload(new Uint8Array(await Bun.file(thumb.path).arrayBuffer()), "image/jpeg");
      await ingest.post("storage", { guid: item.guid, thumbStorageId: storageId as never });
      return;
    }
    // HEIC/TIFF and CAF/AMR become browser-friendly JPEG/M4A first.
    const transcoded = await transcodeAttachment(item.guid, item.mimeType, item.filename, download);
    let bytes: Uint8Array;
    let contentType: string;
    if (transcoded) {
      bytes = new Uint8Array(await Bun.file(transcoded.path).arrayBuffer());
      contentType = transcoded.contentType;
    } else {
      const response = await download();
      if (!response.ok) throw new Error(`download HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
      contentType = item.mimeType ?? response.headers.get("Content-Type") ?? "application/octet-stream";
    }
    const storageId = await ingest.upload(bytes, contentType);
    await ingest.post("storage", { guid: item.guid, originalStorageId: storageId as never });
  }

  stop(): void {
    this.stopped = true;
    this.work.stop();
    this.transcriptWork.stop();
    this.unsubscribeTranscripts();
  }
}
