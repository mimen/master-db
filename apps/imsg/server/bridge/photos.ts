import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { GenericId as Id } from "convex/values";
import type { OverlayDb } from "../db";
import type { ConvexIngest } from "./convex-ingest";
import { RetryWork } from "./retry";

export class PhotoMirror {
  /** Uploads this process made; earlier runs' uploads are skipped by hash. */
  uploaded = 0;
  /** Photos not linked to a person yet: no matching address in Convex, or a failed link. */
  pending = 0;
  /** Photos linked to a person as of the last scan. */
  matched = 0;
  private stopped = false;
  private work: RetryWork;
  private timer: ReturnType<typeof setInterval>;

  constructor(db: OverlayDb, ingest: Pick<ConvexIngest, "post" | "upload">,
    directory = join(import.meta.dir, "../../.cache/avatars")) {
    this.work = new RetryWork("photos", async () => {
      const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".img"));
      this.pending = files.length;
      let matched = 0;
      let failure: unknown;
      for (const entry of files) {
        if (this.stopped) break;
        try {
          const address = entry.name.slice(0, -4);
          const bytes = new Uint8Array(await Bun.file(join(directory, entry.name)).arrayBuffer());
          const hash = createHash("sha256").update(bytes).digest("hex");
          let prior = db.getBridgePhoto(address);
          if (prior?.hash !== hash) {
            const contentType = bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png"
              : new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp" ? "image/heic" : "image/jpeg";
            const storageId = await ingest.upload(bytes, contentType);
            db.setBridgePhoto(address, hash, storageId, false);
            prior = { hash, storageId, matched: 0 };
            this.uploaded++;
          }
          if (!prior.matched) {
            const matched = await ingest.post("photo", { address, hash, storageId: prior.storageId as Id<"_storage"> });
            if (!matched) continue;
            db.setBridgePhoto(address, hash, prior.storageId, true);
          }
          this.pending--;
          matched++;
        } catch (error) {
          console.error(`comma bridge photo ${entry.name}: ${String(error)}`);
          failure = error;
        }
      }
      this.matched = matched;
      if (failure) throw failure;
    });
    this.timer = setInterval(() => this.request(), 10 * 60_000);
    this.timer.unref();
    this.request();
  }

  request(): void { this.work.request(); }
  flush(): Promise<void> { return this.work.flush(); }
  stop(): void { this.stopped = true; clearInterval(this.timer); this.work.stop(); }
}
