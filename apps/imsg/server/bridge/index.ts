import type { BlueBubbles } from "../bluebubbles";
import type { ChatCommands } from "../commands";
import type { ConvexClient } from "convex/browser";
import { OutboxBridge } from "./outbox";
import type { Config } from "../config";
import type { OverlayDb } from "../db";
import type { NameSource } from "../name-resolver";
import { ConvexIngest } from "./convex-ingest";
import { LiveBridge, MessageWriter } from "./live";
import { MediaWorker } from "./media";
import { OverlayMirror } from "./overlay-mirror";
import { PhotoMirror } from "./photos";
import { ReconcileBridge } from "./reconcile";
import { RetryWork } from "./retry";
import { ScheduledMirror } from "./scheduled-mirror";

export function startBridge(deps: {
  config: Config;
  bb: BlueBubbles;
  db: OverlayDb;
  commands: ChatCommands;
  outboxClient?: ConvexClient;
  names?: NameSource;
  backgroundServices?: boolean;
  ingest?: Pick<ConvexIngest, "post" | "upload">;
  chatDbPath?: string;
  avatarDirectory?: string;
  now?: () => number;
}) {
  const enabled = Boolean(deps.config.commaBridgeSecret) && deps.backgroundServices !== false;
  let live: LiveBridge | null = null;
  let reconcile: ReconcileBridge | null = null;
  let overlay: OverlayMirror | null = null;
  let scheduled: ScheduledMirror | null = null;
  let outbox: OutboxBridge | null = null;
  let media: MediaWorker | null = null;
  let photos: PhotoMirror | null = null;
  function stopModules() {
    live?.stop(); reconcile?.stop(); overlay?.stop(); scheduled?.stop(); outbox?.stop(); media?.stop(); photos?.stop();
    live = null; reconcile = null; overlay = null; scheduled = null; outbox = null; media = null; photos = null;
  }
  const startup = new RetryWork("startup", async () => {
    if (!deps.config.convexSiteUrl) throw new Error("CONVEX_SITE_URL is unset");
    const ingest = deps.ingest ?? new ConvexIngest(deps.config);
    const writer = new MessageWriter({ bb: deps.bb, db: deps.db, ingest, names: deps.names });
    try {
      reconcile = new ReconcileBridge(writer, deps.config, { chatDbPath: deps.chatDbPath, now: deps.now });
      live = new LiveBridge(writer, deps.now);
      overlay = new OverlayMirror(writer);
      scheduled = new ScheduledMirror(deps.bb, ingest);
      photos = new PhotoMirror(deps.db, ingest, deps.avatarDirectory);
      outbox = new OutboxBridge({ config: deps.config, writer, commands: deps.commands, client: deps.outboxClient, now: deps.now });
      const worker = new MediaWorker({ bb: deps.bb, db: deps.db, ingest, isBusy: () => (live?.pending ?? 0) > 0 });
      media = worker;
      writer.onAttachments = (rows, createdAt) => worker.enqueue(rows, createdAt);
      worker.start();
      void worker.seedFromConvex().catch((error) => console.error(`comma bridge media seed: ${String(error)}`));
      void worker.copyTranscripts().catch((error) => console.error(`comma bridge transcripts: ${String(error)}`));
      console.log(`comma bridge: on (cursor ${reconcile.cursor})`);
    } catch (error) {
      stopModules();
      throw error;
    }
  });
  if (enabled) startup.request();
  else console.log(deps.config.commaBridgeSecret
    ? "comma bridge: off (background services disabled)" : "comma bridge: off (no COMMA_BRIDGE_SECRET)");

  return {
    health: () => ({ enabled, lastEventAt: live?.lastEventAt ?? null,
      lastReconcileAt: reconcile?.lastReconcileAt ?? null, cursor: reconcile?.cursor ?? 0,
      outbox: { inFlight: outbox?.inFlight ?? 0, lastExecutedAt: outbox?.lastExecutedAt ?? null },
      photos: { uploaded: photos?.uploaded ?? 0, pending: photos?.pending ?? 0 },
      media: media ? { ...media.counts(), uploadedToday: media.uploadedToday, lastError: media.lastError } : null,
      pending: startup.pending + (live?.pending ?? 0) + (reconcile?.pending ?? 0) + (overlay?.pending ?? 0) + (scheduled?.pending ?? 0) + (outbox?.pending ?? 0) }),
    scheduledChanged: () => scheduled?.request(),
    flush: async () => {
      await startup.flush();
      await outbox?.flush();
      await live?.flush();
      await reconcile?.flush();
      await overlay?.flush();
      await scheduled?.flush();
      await media?.flush();
      await photos?.flush();
    },
    stop: () => { startup.stop(); stopModules(); },
  };
}
