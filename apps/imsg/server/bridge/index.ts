import type { IMessageHandlers } from "./commands/types";
import type { BlueBubbles } from "../bluebubbles";
import type { ChatCommands } from "../commands";
import { ConvexClient } from "convex/browser";
import type { Config } from "../config";
import type { OverlayDb } from "../db";
import { accountStatusKey } from "../../shared/executors";
import { imessageHandlers } from "./commands";
import { typingHandler } from "./commands/presence";
import { IMESSAGE_ACCOUNT } from "../../../../convex/comma/conversationIdentity";
import { ConvexIngest, withAccount } from "./convex-ingest";
import { GroupPhotoMirror } from "./group-photos";
import { LiveBridge, MessageWriter } from "./live";
import { MediaWorker } from "./media";
import { imessageLane, OutboxBridge } from "./outbox";
import { PhotoMirror } from "./photos";
import { OutboundTyping } from "./presence";
import { ReconcileBridge } from "./reconcile";
import { RetryWork } from "./retry";
import { readSelfHandles } from "./self-handles";
import { ScheduledMirror } from "./scheduled-mirror";
import { StatusPublisher } from "./state";
import { UnreadMirror } from "./unread";

/** The Mini's iMessage executor: mirrors BlueBubbles into Convex and drains the imessage lane. Model work runs in server/ai/main.ts. */
export function startBridge(deps: {
  config: Config;
  bb: BlueBubbles;
  db: OverlayDb;
  commands: ChatCommands;
  outboxClient?: ConvexClient;
  backgroundServices?: boolean;
  ingest?: Pick<ConvexIngest, "post" | "upload">;
  chatDbPath?: string;
  avatarDirectory?: string;
  now?: () => number;
  handlers?: Partial<IMessageHandlers>;
}) {
  const enabled = Boolean(deps.config.commaBridgeSecret) && deps.backgroundServices !== false;
  let typing: OutboundTyping | null = null;
  let state: StatusPublisher | null = null;
  let live: LiveBridge | null = null;
  let reconcile: ReconcileBridge | null = null;
  let unread: UnreadMirror | null = null;
  let scheduled: ScheduledMirror | null = null;
  let outbox: OutboxBridge | null = null;
  let media: MediaWorker | null = null;
  let photos: PhotoMirror | null = null;
  let groupPhotos: GroupPhotoMirror | null = null;
  function stopModules() {
    groupPhotos?.stop(); groupPhotos = null;
    typing?.stop(); typing = null;
    state?.stop(); state = null;
    unread?.stop(); unread = null;
    live?.stop(); reconcile?.stop(); scheduled?.stop(); outbox?.stop(); media?.stop(); photos?.stop();
    live = null; reconcile = null; scheduled = null; outbox = null; media = null; photos = null;
  }
  const startup = new RetryWork("startup", async () => {
    if (!deps.config.convexSiteUrl) throw new Error("CONVEX_SITE_URL is unset");
    const base = deps.ingest ?? new ConvexIngest(deps.config);
    // Every batch names the account it writes for; Convex seeds iMessage's on first use.
    const selfHandles = readSelfHandles(deps.chatDbPath);
    const accountId = await base.post("account", { ...IMESSAGE_ACCOUNT, ...(selfHandles ? { selfHandles } : {}) });
    const ingest = withAccount(base, { platform: IMESSAGE_ACCOUNT.platform, accountId });
    const writer = new MessageWriter({ bb: deps.bb, db: deps.db, ingest });
    try {
      groupPhotos = new GroupPhotoMirror(deps.bb, deps.db, ingest);
      writer.onChats = (chats) => groupPhotos?.observe(chats);
      typing = new OutboundTyping(deps.bb, deps.now);
      // BlueBubbles capabilities can change during its periodic REST reconnect, and a socket reconnect re-reads them.
      state = new StatusPublisher({ key: accountStatusKey("imessage", accountId), ingest, now: deps.now,
        report: () => ({ connected: true, capabilities: { executor: "imessage", privateApi: deps.bb.hasPrivateApi, emojiReactions: deps.bb.hasEmojiReactions } }),
        reconnects: (listener) => deps.bb.onEvent((event) => { if (event.kind === "stream-connected") listener(); }) });
      reconcile = new ReconcileBridge(writer, deps.config, { chatDbPath: deps.chatDbPath, now: deps.now });
      scheduled = new ScheduledMirror(deps.bb, ingest);
      live = new LiveBridge(writer, deps.now, (rows) => {
        // A scheduled message firing arrives as an ordinary outgoing message; refresh the
        // mirror then instead of leaving Scheduled stale until its five-minute poll.
        if (rows.some((row) => row.isFromMe)) scheduled?.request();
      });
      unread = new UnreadMirror(writer, { chatDbPath: deps.chatDbPath });
      photos = new PhotoMirror(deps.db, ingest, deps.avatarDirectory);
      const { convexCloudUrl } = deps.config;
      const client = deps.outboxClient ?? (convexCloudUrl ? new ConvexClient(convexCloudUrl) : undefined);
      const handlers = { ...imessageHandlers, ...deps.handlers, typing: typingHandler(typing, deps.now) };
      outbox = new OutboxBridge({ config: deps.config, ingest, client, now: deps.now,
        lanes: [imessageLane({ writer, commands: deps.commands, handlers })] });
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
      photos: { matched: photos?.matched ?? 0, pending: photos?.pending ?? 0, uploadedThisRun: photos?.uploaded ?? 0 },
      media: media ? { ...media.counts(), uploadedToday: media.uploadedToday, lastError: media.lastError } : null,
      pending: (state?.pending ?? 0) + startup.pending + (live?.pending ?? 0) + (reconcile?.pending ?? 0) + (unread?.pending ?? 0) + (scheduled?.pending ?? 0) + (outbox?.pending ?? 0) }),
    scheduledChanged: () => scheduled?.request(),
    flush: async () => {
      await startup.flush();
      await state?.flush();
      await typing?.flush();
      await outbox?.flush();
      await live?.flush();
      await reconcile?.flush();
      await unread?.flush();
      await scheduled?.flush();
      await media?.flush();
      await photos?.flush();
      await groupPhotos?.flush();
    },
    stop: () => { startup.stop(); stopModules(); },
  };
}
