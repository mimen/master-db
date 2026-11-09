import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { AI_STATUS_KEY } from "../../shared/executors";
import { createAiHandlers } from "../bridge/commands/ai";
import { ConvexIngest } from "../bridge/convex-ingest";
import { aiLane, OutboxBridge } from "../bridge/outbox";
import { StatusPublisher } from "../bridge/state";
import { PERSON_SUMMARY_BUDGET, PrecomputeBudget } from "../bridge/suggestions";
import { loadAiSettings, loadGatewayKey, type AiConfig, type WhisperConfig } from "../config";
import { OverlayDb } from "../db";
import { buildToday, todayPort } from "../today/build";
import { startTodayWorker, type PendingBuild } from "../today/worker";
import { WhisperService, type AudioSource } from "../whisper";
import { loadProfile } from "./context";
import { Gateway } from "./gateway";
import { summarizePerson } from "./person-summary";
import { AiService } from "./service";
import { makeVaultSearch } from "./vault";

/**
 * comma:ai, the Mini's model process: the ai outbox lane (suggestions, identify, feedback, transcription), the
 * aiBackground lane (suggestion precompute, person summaries), the Today build, and its own `ai` status row. It reads and writes only Convex, through the bridge ingest routes, and never
 * BlueBubbles, so it needs no BB_PASSWORD.
 */

export type AiServiceLike = Pick<
  AiService,
  "available" | "replySuggestions" | "identify" | "recordSuggestionFeedback" | "recordReactionFeedback" | "clearSuggestionLearning"
> & Partial<Pick<AiService, "cachedReplySuggestions">>;

export type AiProcessConfig = {
  convexCloudUrl: string;
  convexSiteUrl: string;
  commaBridgeSecret: string;
  dbPath: string;
  ai: AiConfig;
  whisper: WhisperConfig;
};

export function loadAiProcessConfig(env: Record<string, string | undefined>, gatewayKey: string): AiProcessConfig {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`comma ai: ${name} is unset`);
    return value.replace(/\/$/, "");
  };
  return {
    convexCloudUrl: required("CONVEX_CLOUD_URL"),
    convexSiteUrl: required("CONVEX_SITE_URL"),
    commaBridgeSecret: required("COMMA_BRIDGE_SECRET"),
    dbPath: env.DB_PATH ?? "imsg.db",
    ...loadAiSettings(env, gatewayKey),
  };
}

/** A memo's original from Convex storage, read by its conversation the way the agent reads attachments. */
export function storedAudio(ingest: Pick<ConvexIngest, "post">, fetchUrl: (url: string) => Promise<Response> = fetch): AudioSource {
  return async (guid, conversationId) => {
    const link = await ingest.post("agentAttachment", { conversationId, guid });
    if (!link) return { ok: false, error: "Attachment is not mirrored yet" };
    if (!link.url) return { ok: false, error: "The original is not in Convex storage yet" };
    const response = await fetchUrl(link.url);
    if (!response.ok) return { ok: false, error: `Audio download failed (${response.status})` };
    // The bridge stores a CAF or AMR memo transcoded to M4A, so the stored bytes' type names the file, not the original's name.
    const extension = STORED_AUDIO_EXTENSIONS[response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? ""];
    return { ok: true, bytes: new Uint8Array(await response.arrayBuffer()), filename: extension ? `${guid}${extension}` : link.name };
  };
}

const STORED_AUDIO_EXTENSIONS: Readonly<Record<string, string>> = {
  "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/mpeg": ".mp3", "audio/x-caf": ".caf", "audio/amr": ".amr", "audio/wav": ".wav",
};

const pendingBuild = makeFunctionReference<"query", { bridgeKey: string }, PendingBuild | null>("comma/today:pendingBuild");

export function startAi(deps: {
  config: AiProcessConfig;
  db: OverlayDb;
  ingest: Pick<ConvexIngest, "post" | "request">;
  client: ConvexClient;
  ai?: AiServiceLike;
  gateway?: Gateway;
  whisper?: WhisperService;
  now?: () => number;
}) {
  const { config, db, ingest, client } = deps;
  const now = deps.now ?? Date.now;
  const gateway = deps.gateway ?? new Gateway(config.ai);
  const ai = deps.ai ?? new AiService({
    config: config.ai,
    db,
    gateway,
    fetchThread: async (conversationId) => {
      try { return { ok: true, value: await ingest.post("aiThread", { conversationId }) }; }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    },
    sentText: async ({ platform, accountId }) => await ingest.post("aiSentText", { platform, ...(accountId ? { accountId } : {}) }),
    searchVault: makeVaultSearch(config.ai.vaultPath),
  });
  const whisper = deps.whisper ?? new WhisperService(config.whisper, db, storedAudio(ingest));
  const budget = new PrecomputeBudget(db, now);
  const summaryBudget = new PrecomputeBudget(db, now, PERSON_SUMMARY_BUDGET);
  const status = new StatusPublisher({ key: AI_STATUS_KEY, ingest, now, report: () => {
    const transcription = whisper.availability();
    return {
      connected: ai.available,
      ...(ai.available ? {} : { detail: "The AI gateway key is not configured" }),
      capabilities: { executor: "ai", suggestions: ai.available, whisperAvailable: transcription.available,
        ...(transcription.available ? {} : { whisperDetail: transcription.detail }) },
    };
  } });
  const handlers = createAiHandlers({ ai, whisper, budget, now, summaryBudget,
    summarize: (port, personId, signal) => summarizePerson({ port, gateway, now }, personId, signal) });
  // A precompute drains in its own lane, so a user's suggestion or transcription never waits behind one.
  const outbox = new OutboxBridge({ config, ingest, client, now,
    lanes: [aiLane({ ingest, handlers }), aiLane({ ingest, handlers, lane: "aiBackground" })] });
  const port = todayPort(ingest);
  const today = startTodayWorker({
    subscribe: (receive) => client.onUpdate(pendingBuild, { bridgeKey: config.commaBridgeSecret }, receive,
      (error) => console.error(`comma ai today subscription: ${String(error)}`)),
    port,
    build: (claim, signal) => buildToday({ gateway, profile: () => loadProfile(config.ai.vaultPath), store: db, port, now, log: console.log }, claim, signal),
  });
  return {
    health: () => ({ suggestions: budget.health(), personSummaries: summaryBudget.health(), outbox: { inFlight: outbox.inFlight, lastExecutedAt: outbox.lastExecutedAt } }),
    flush: async () => { await status.flush(); await outbox.flush(); },
    stop: () => { today.stop(); outbox.stop(); status.stop(); },
  };
}

async function main() {
  let config: AiProcessConfig;
  try {
    config = loadAiProcessConfig(Bun.env, loadGatewayKey());
  } catch (error) {
    // KeepAlive restarts a crashed process at once; an unconfigured one waits for its .env instead.
    console.error(`${error instanceof Error ? error.message : String(error)}; idling`);
    setInterval(() => {}, 1 << 30);
    return;
  }
  const client = new ConvexClient(config.convexCloudUrl);
  const running = startAi({ config, db: new OverlayDb(config.dbPath), ingest: new ConvexIngest(config), client });
  console.error(`comma ai: started (gateway ${config.ai.gatewayKey ? "configured" : "missing"})`);
  const shutdown = () => {
    running.stop();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (import.meta.main) await main();
