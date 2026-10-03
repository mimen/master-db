import type { BlueBubbles } from "../bluebubbles";
import type { Config } from "../config";
import type { OverlayDb } from "../db";
import type { NameSource } from "../name-resolver";
import { ConvexIngest } from "./convex-ingest";
import { LiveBridge, MessageWriter } from "./live";
import { OverlayMirror } from "./overlay-mirror";
import { ReconcileBridge } from "./reconcile";
import { RetryWork } from "./retry";
import { ScheduledMirror } from "./scheduled-mirror";

export function startBridge(deps: {
  config: Config;
  bb: BlueBubbles;
  db: OverlayDb;
  names?: NameSource;
  backgroundServices?: boolean;
  ingest?: Pick<ConvexIngest, "post">;
  chatDbPath?: string;
  now?: () => number;
}) {
  const enabled = Boolean(deps.config.commaBridgeSecret) && deps.backgroundServices !== false;
  let live: LiveBridge | null = null;
  let reconcile: ReconcileBridge | null = null;
  let overlay: OverlayMirror | null = null;
  let scheduled: ScheduledMirror | null = null;
  function stopModules() {
    live?.stop(); reconcile?.stop(); overlay?.stop(); scheduled?.stop();
    live = null; reconcile = null; overlay = null; scheduled = null;
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
      pending: startup.pending + (live?.pending ?? 0) + (reconcile?.pending ?? 0) + (overlay?.pending ?? 0) + (scheduled?.pending ?? 0) }),
    scheduledChanged: () => scheduled?.request(),
    flush: async () => {
      await startup.flush();
      await live?.flush();
      await reconcile?.flush();
      await overlay?.flush();
      await scheduled?.flush();
    },
    stop: () => { startup.stop(); stopModules(); },
  };
}
