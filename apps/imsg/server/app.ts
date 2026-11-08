import { Hono } from "hono";
import type { BlueBubbles } from "./bluebubbles";
import { startBridge } from "./bridge";
import { createAiHandlers } from "./bridge/commands/ai";
import { ConvexIngest } from "./bridge/convex-ingest";
import type { Config } from "./config";
import { registerConvexTokenRoute, type ConvexAuthClient } from "./convex-token";
import { registerDesktopReleaseRoutes } from "./desktop-version";
import { registerDeployStatusRoute } from "./deploy-status";
import { ContactBook } from "./contacts";
import { OverlayDb } from "./db";
import { IdentityMirror } from "./identity-mirror";
import { IdentitySync } from "./identity-sync";
import { NameResolver } from "./name-resolver";
import { ChatCommands } from "./commands";
import { WhisperService } from "./whisper";
import { precompressedStatic } from "./compression";
import { AiService } from "./ai/service";
import { loadProfile } from "./ai/context";
import { Gateway } from "./ai/gateway";
import { makeVaultSearch } from "./ai/vault";
import type { NameSource } from "./name-resolver";

export interface FixtureRouteControls {
  readonly ai: AiServiceLike;
  readonly health: () => { ok: boolean; privateApi: boolean; emojiReactions: boolean; eventClients: number; commaBridge: ReturnType<ReturnType<typeof startBridge>["health"]> };
}

export interface IdentityDirectory {
  refresh(): Promise<void>;
  start(): void;
  stop(): void;
  search(query: string, limit: number): Array<{ address: string; name: string; is_favorite?: boolean }>;
}

export type AiServiceLike = Pick<
  AiService,
  | "available"
  | "replySuggestions"
  | "identify"
  | "recordSuggestionFeedback"
  | "recordReactionFeedback"
  | "clearSuggestionLearning"
> & Partial<Pick<AiService, "cachedReplySuggestions">>;

export interface AppDependencies {
  config: Config;
  bb: BlueBubbles;
  db: OverlayDb;
  now?: () => number;
  convexAuthClient?: ConvexAuthClient;
  names?: NameSource;
  identity?: IdentityDirectory;
  ai?: AiServiceLike;
  backgroundServices?: boolean;
  bridgeIngest?: Pick<ConvexIngest, "post" | "upload">;
  bridgeChatDbPath?: string;
  bridgeAvatarDirectory?: string;
  staticRoot?: string;
  desktopRoot?: string;
  desktopReleaseRoot?: string;
  webReleaseManifestPath?: string;
  configureFixtureRoutes?: (app: Hono, controls: FixtureRouteControls) => void;
}

export interface CreatedApp {
  app: Hono;
  dispose(): void;
}

export async function createApp(deps: AppDependencies): Promise<CreatedApp> {
const { config, bb, db } = deps;
const staticRoot = deps.staticRoot ?? "./client/dist";
const desktopRoot = deps.desktopRoot ?? `${import.meta.dir}/..`;
const desktopReleaseRoot = deps.desktopReleaseRoot ?? `${import.meta.dir}/../desktop/releases`;
const deployStateDir = process.env.IMSG_DEPLOY_STATE_DIR
  ?? `${process.env.HOME ?? ""}/Library/Application Support/imsg-deploy`;
const webReleaseManifestPath = deps.webReleaseManifestPath ?? `${deployStateDir}/web-release.json`;
const now = deps.now ?? Date.now;
const contacts = new ContactBook(bb);
const productionIdentity = deps.identity ? null : new IdentityMirror(config);
const identity = deps.identity ?? productionIdentity;
if (!identity) throw new Error("identity directory unavailable");
const names = deps.names ?? new NameResolver(productionIdentity ?? new IdentityMirror(config), contacts);
const identitySync = new IdentitySync(bb, config, () => void identity.refresh());
const whisper = new WhisperService(config.whisper, bb, db);

const gateway = new Gateway(config.ai);
const convexReads = deps.bridgeIngest ?? new ConvexIngest(config);
const ai = deps.ai ?? new AiService({
  config: config.ai,
  db,
  gateway,
  fetchThread: async (conversationId) => {
    try { return { ok: true, value: await convexReads.post("aiThread", { conversationId }) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  },
  sentText: async ({ platform, accountId }) => await convexReads.post("aiSentText", { platform, ...(accountId ? { accountId } : {}) }),
  bridgeSupport: () => ({ privateApi: bb.hasPrivateApi, emojiReactions: bb.hasEmojiReactions }),
  contactEmails: (address) => contacts.emails(address),
  searchVault: makeVaultSearch(config.ai.vaultPath),
});

const info = await bb.connect();
if (!info.ok) {
  console.error(`Cannot reach BlueBubbles at ${config.bbUrl}: ${info.error}`);
} else {
  console.log(
    `BlueBubbles ${info.value.server_version ?? "?"} connected, private API: ${bb.hasPrivateApi}`,
  );
}
const whisperStatus = whisper.availability();
console.log(
  whisperStatus.available
    ? `Whisper transcription available (${config.whisper.modelPath})`
    : `Whisper transcription unavailable: ${whisperStatus.detail}`,
);
await contacts.refresh(true);

let reconnectTimer: ReturnType<typeof setInterval> | null = null;
if (deps.backgroundServices !== false) {
  identity.start();
  identitySync.start();
  // ContactBook's refresh is TTL-gated; this tick keeps the name fallback current.
  reconnectTimer = setInterval(() => { void bb.connect(); void contacts.refresh(); }, 5 * 60_000);
}

const commands = new ChatCommands(bb, names, () => commaBridge.scheduledChanged());
const commaBridge = startBridge({ config, bb, db, now, commands,
  backgroundServices: deps.backgroundServices, ingest: deps.bridgeIngest, chatDbPath: deps.bridgeChatDbPath,
  avatarDirectory: deps.bridgeAvatarDirectory,
  capabilities: () => {
    const status = whisper.availability();
    return { privateApi: bb.hasPrivateApi, emojiReactions: bb.hasEmojiReactions, suggestions: ai.available, reactionSuggestions: bb.hasPrivateApi,
      whisperAvailable: status.available, ...(status.available ? {} : { whisperDetail: status.detail }) };
  },
  suggestions: { ai },
  handlers: createAiHandlers({ ai, whisper, now }),
  today: { gateway, profile: () => loadProfile(config.ai.vaultPath) } });

// ------------------------------------------------------------------- routes

const app = new Hono();

app.onError((err, c) => {
  console.error(`${c.req.method} ${c.req.path}:`, err.message);
  return c.json({ error: err.message }, 500);
});

const health = () => ({ ok: true, privateApi: bb.hasPrivateApi, emojiReactions: bb.hasEmojiReactions, eventClients: 0, commaBridge: commaBridge.health() });
app.get("/api/health", (c) => c.json(health()));

// Immutable release identity consumed by the thin desktop shell.
registerDeployStatusRoute(app, webReleaseManifestPath);
registerDesktopReleaseRoutes(app, desktopRoot, desktopReleaseRoot);
registerConvexTokenRoute(app, config, { client: deps.convexAuthClient, now });

deps.configureFixtureRoutes?.(app, { ai, health });

// Unknown API paths must remain API 404s instead of falling through to the
// SPA shell, which would turn a client typo into a misleading 200 HTML reply.
app.get("/api/*", (c) => c.json({ error: "Not found" }, 404));

// -------------------------------------------------------------- static app
// The universal Expo web export. Expo static output has one HTML file per
// route, so dynamic segments need explicit rewrites.

app.use("/*", precompressedStatic(staticRoot));
app.get("*", precompressedStatic(staticRoot, true));

return {
  app,
  dispose: () => {
    if (reconnectTimer) clearInterval(reconnectTimer);
    commaBridge.stop();
    identitySync.stop();
    identity.stop();
  },
};
}
