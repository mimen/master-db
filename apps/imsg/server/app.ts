import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";
import type { BBAttributedBody, BBMessage } from "./bb-types";
import type { BlueBubbles } from "./bluebubbles";
import { ChatDirectory } from "./chat-directory";
import type { Config } from "./config";
import { registerDesktopReleaseRoutes } from "./desktop-version";
import { registerDeployStatusRoute } from "./deploy-status";
import { ContactBook } from "./contacts";
import { OverlayDb } from "./db";
import { GroupPhotos } from "./group-photos";
import { IdentityMirror } from "./identity-mirror";
import { IdentitySync } from "./identity-sync";
import { MessageSearch } from "./message-search";
import { ChatDb } from "./chatdb";
import {
  createdChatError,
  messageBelongsToAnyChat,
  outboundAddressesError,
  outboundTextError,
} from "./message-verification";
import { NameResolver } from "./name-resolver";
import { computeCounts, matchesFilters } from "../shared/chat-state";
import { fetchLinkPreview } from "./link-preview";
import { buildThread, mapMessage } from "./map";
import { wireLiveEvents } from "./live-events";
import type { MentionAnnotation } from "../shared/mentions";
import { buildMentionAttributedBody } from "./mention-body";
import { transcodeAttachment } from "./transcode";
import { mapScheduledMessage } from "./scheduled";
import { ScheduledSendNow } from "./scheduled-send-now";
import { WhisperService } from "./whisper";
import { createAndSendFaceTimeLink } from "./facetime";
import { parseByteRange } from "./byte-range";
import { staticCacheControl } from "./static-cache";
import { AiService } from "./ai/service";
import { Gateway } from "./ai/gateway";
import { ShadowRunner, spawnExec, probeShadow } from "./ai/shadow";
import { makeVaultSearch } from "./ai/vault";
import type {
  Contact,
  ServerEvent,
  StateFilter,
  SuggestionFeedbackRequest,
  SuggestionModel,
  TypeFilter,
} from "../shared/types";
import type { NameSource } from "./name-resolver";

export interface FixtureRouteControls {
  readonly broadcast: (event: ServerEvent) => void;
  readonly directory: ChatDirectory;
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
  | "groupNames"
  | "replySuggestions"
  | "identify"
  | "smartCloser"
  | "shadowBrief"
  | "shadowPending"
  | "shadowEnqueue"
  | "recordSuggestionFeedback"
  | "recordReactionFeedback"
  | "clearSuggestionLearning"
>;

export interface AppDependencies {
  config: Config;
  bb: BlueBubbles;
  db: OverlayDb;
  now?: () => number;
  names?: NameSource;
  identity?: IdentityDirectory;
  ai?: AiServiceLike;
  shadowStatus?: { available: boolean; detail: string };
  backgroundServices?: boolean;
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
const directory = new ChatDirectory(bb, db, contacts, now, names);
const search = new MessageSearch(bb, names);
const chatDb = new ChatDb();
const photos = new GroupPhotos(bb);
const identitySync = new IdentitySync(bb, config, () => void identity.refresh());
const whisper = new WhisperService(config.whisper, bb, db);
const scheduledSendNow = new ScheduledSendNow(bb);

const gateway = new Gateway(config.ai);
// Probed once per app creation: whether the harness lane's dependencies (ccs
// binary, synced seat) are actually present, not merely whether the key exists.
const shadowStatus = deps.shadowStatus ?? probeShadow(config.ai, {
  which: (bin) => Bun.which(bin),
  seatExists: (dir) => {
    try {
      return require("node:fs").statSync(dir).isFile();
    } catch {
      return false;
    }
  },
});
const ai = deps.ai ?? new AiService({
  config: config.ai,
  db,
  gateway,
  shadow: new ShadowRunner(
    config.ai,
    { get: (key) => db.getAiMeta(key), set: (key, value) => db.setAiMeta(key, value) },
    spawnExec,
  ),
  shadowStatus,
  fetchMessages: async (chatGuid) => {
    const result = await bb.chatMessages(chatGuid, { limit: 60, sort: "DESC" });
    return result.ok
      ? { ok: true, value: buildThread(result.value, chatGuid, names) }
      : result;
  },
  fetchMessageWithReactions: async (chatGuid, messageGuid) => {
    const result = await bb.messageWithReactions(messageGuid);
    if (!result.ok) return result;
    const message = buildThread(result.value, chatGuid, names).find((item) => item.guid === messageGuid);
    return message ? { ok: true, value: message } : { ok: false, error: "reaction target not found" };
  },
  recentOutboundText: () => chatDb.recentOutboundText(200),
  reactionSuggestions: () => bb.hasPrivateApi,
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
  reconnectTimer = setInterval(() => void bb.connect(), 5 * 60_000);
}

// ---------------------------------------------------------------- SSE fanout

type SSEClient = { id: number; send: (event: ServerEvent) => void };
const sseClients = new Set<SSEClient>();
let sseClientId = 0;

function broadcast(event: ServerEvent): void {
  for (const client of sseClients) client.send(event);
}

// Any directory invalidation fans out as a chats-changed event.
directory.onEvent(() => broadcast({ kind: "chats-changed" }));

// ------------------------------------------------- BlueBubbles event stream

wireLiveEvents(bb, directory, names, broadcast);

// ------------------------------------------------------------------- routes

const app = new Hono();

app.onError((err, c) => {
  console.error(`${c.req.method} ${c.req.path}:`, err.message);
  return c.json({ error: err.message }, 500);
});

app.get("/api/health", async (c) => {
  return c.json({ ok: true, privateApi: bb.hasPrivateApi });
});

// Immutable release identity consumed by the thin desktop shell.
registerDeployStatusRoute(app, webReleaseManifestPath);
registerDesktopReleaseRoutes(app, desktopRoot, desktopReleaseRoot);

// Lets the client force the Identity Mirror to catch up immediately after an
// in-app "Add Contact" / rename, instead of waiting for its 5-minute tick.
// Also invalidates the directory so the next /api/chats reflects the new names.
app.post("/api/identity/refresh", async (c) => {
  await identity.refresh();
  directory.invalidate();
  return c.body(null, 204);
});

app.get("/api/chats", async (c) => {
  const stateQ = c.req.query("state") ?? "all";
  const type = (c.req.query("type") ?? "all") as TypeFilter;
  const result = await directory.summaries();
  if (!result.ok) return c.json({ error: result.error }, 502);
  // "any" returns the raw list (archived included) for clients that filter locally.
  if (stateQ === "any") return c.json(result.chats);
  return c.json(result.chats.filter((chat) => matchesFilters(chat, stateQ as StateFilter, type)));
});

app.get("/api/counts", async (c) => {
  const type = (c.req.query("type") ?? "all") as TypeFilter;
  const result = await directory.summaries();
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json(computeCounts(result.chats, type));
});

app.get("/api/chats/:guid/messages", async (c) => {
  const chatGuid = c.req.param("guid");
  const before = c.req.query("before");
  const after = c.req.query("after");
  const around = c.req.query("around");
  // One person, one thread: pull from every service-sibling chat (iMessage/
  // SMS/RCS rows for the same contact) and merge chronologically, like
  // Messages.app does. Ensure the sibling map exists (first hit after boot).
  await directory.summaries();
  const guids = directory.siblingGuids(chatGuid);

  if (around) {
    // Jump-to-message: fetch a window on both sides of the target timestamp.
    const target = Number(around);
    const pages = await Promise.all(
      guids.flatMap((g) => [
        bb.chatMessages(g, { before: target + 1, limit: 40, sort: "DESC" }),
        bb.chatMessages(g, { after: target, limit: 40, sort: "ASC" }),
      ]),
    );
    if (pages.every((p) => !p.ok)) return c.json({ error: "fetch failed" }, 502);
    const merged = new Map<string, BBMessage>();
    for (const page of pages) if (page.ok) for (const m of page.value) merged.set(m.guid, m);
    return c.json(buildThread([...merged.values()], chatGuid, names));
  }

  // buildThread drops tapbacks/reactions, so a raw page can filter down to very
  // few real messages. Keep paging until we have a solid batch or truly run out,
  // otherwise the client stops paginating and old history looks unreachable.
  const sort: "ASC" | "DESC" = after ? "ASC" : "DESC";
  const TARGET = 40;
  const RAW_LIMIT = 100;

  const fetchPages = async (guid: string): Promise<BBMessage[] | null> => {
    const raw: BBMessage[] = [];
    let cursorBefore = before ? Number(before) : undefined;
    let cursorAfter = after ? Number(after) : undefined;
    for (let page = 0; page < 6; page++) {
      const result = await bb.chatMessages(guid, {
        before: cursorBefore,
        after: cursorAfter,
        sort,
        limit: RAW_LIMIT,
      });
      if (!result.ok) return raw.length === 0 ? null : raw;
      if (result.value.length === 0) break;
      raw.push(...result.value);
      const real = raw.filter((m) => !m.associatedMessageGuid && !m.dateRetracted).length;
      if (real >= TARGET || result.value.length < RAW_LIMIT) break;
      const dates = result.value.map((m) => m.dateCreated ?? 0).filter((d) => d > 0);
      if (dates.length === 0) break;
      if (sort === "DESC") cursorBefore = Math.min(...dates);
      else cursorAfter = Math.max(...dates);
    }
    return raw;
  };

  const results = await Promise.all(guids.map(fetchPages));
  if (results.every((r) => r === null)) return c.json({ error: "fetch failed" }, 502);
  const merged = new Map<string, BBMessage>();
  for (const r of results) if (r) for (const m of r) merged.set(m.guid, m);
  return c.json(buildThread([...merged.values()], chatGuid, names));
});

app.get("/api/chats/:guid/messages/:messageGuid", async (c) => {
  const chatGuid = c.req.param("guid");
  const messageGuid = c.req.param("messageGuid");
  if (messageGuid.includes("/") || messageGuid.includes("..")) {
    return c.json({ error: "invalid message GUID" }, 400);
  }
  const result = await bb.messageWithReactions(messageGuid);
  if (!result.ok) return c.json({ error: result.error }, 502);
  await directory.summaries();
  const rawMessage = result.value.find((candidate) => candidate.guid === messageGuid);
  if (!rawMessage || !messageBelongsToAnyChat(rawMessage, [chatGuid])) {
    return c.json({ error: "message not found in chat" }, 404);
  }
  const message = buildThread(result.value, chatGuid, names).find(
    (candidate) => candidate.guid === messageGuid,
  );
  return message ? c.json(message) : c.json({ error: "message not found" }, 404);
});

app.get("/api/avatars/:address", async (c) => {
  const address = c.req.param("address");
  const headers = { "Cache-Control": "private, max-age=3600" };

  // Primary source: thumbnails exported from the local AddressBook
  // (scripts/export-avatars.ts) — BlueBubbles doesn't surface contact photos.
  const digits = address.replace(/\D/g, "");
  const keys = [
    digits.length >= 7 ? digits.slice(-10) : null,
    address.toLowerCase().replace(/[^a-z0-9@._+-]/g, "_"),
  ].filter((k): k is string => k !== null);
  for (const key of keys) {
    const file = Bun.file(`.cache/avatars/${key}.img`);
    if (await file.exists()) {
      const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
      const isPng = head[0] === 0x89 && head[1] === 0x50;
      return new Response(file, {
        headers: { ...headers, "Content-Type": isPng ? "image/png" : "image/jpeg" },
      });
    }
  }

  // Fallback: whatever BlueBubbles returns (empty on current server version).
  await contacts.refresh();
  const b64 = contacts.avatar(address);
  if (!b64) {
    // No photo → a transparent 1×1 RGBA PNG (color type 6, alpha 0), so the
    // client renders the initials / gradient underneath instead of a
    // broken-image glyph. (An RGB pixel here would show as a black circle.)
    const px = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==",
      "base64",
    );
    // Cached as long as a real photo: most of a 500-row list is photo-less, and a
    // short TTL meant those rows re-hit the network every minute forever. A contact
    // that later gains a photo is picked up by bumping the ?v= on avatarUrl, which
    // is already how the export-avatars run invalidates.
    return new Response(new Uint8Array(px), {
      headers: { "Cache-Control": "private, max-age=3600", "Content-Type": "image/png" },
    });
  }
  const bytes = Buffer.from(b64, "base64");
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  return new Response(new Uint8Array(bytes), {
    headers: { ...headers, "Content-Type": isPng ? "image/png" : "image/jpeg" },
  });
});

app.get("/api/chats/:guid/photo", async (c) => {
  const photo = await photos.photo(c.req.param("guid"));
  if (!photo) return c.body(null, 404);
  return photo;
});

app.get("/api/link-preview", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ error: "url required" }, 400);
  return c.json(await fetchLinkPreview(url));
});

app.post("/api/chats/:guid/send", async (c) => {
  const chatGuid = c.req.param("guid");
  const body = (await c.req.json()) as {
    text: string;
    replyToGuid?: string;
    replyToPart?: number;
    mentions?: MentionAnnotation[];
  };
  const textError = outboundTextError(body.text);
  if (textError) return c.json({ error: textError }, 400);

  let attributedBody: BBAttributedBody | undefined;
  if (body.mentions && body.mentions.length > 0 && bb.hasPrivateApi && /^iMessage;/i.test(chatGuid)) {
    const built = buildMentionAttributedBody(body.text, body.mentions);
    if (!built.ok) return c.json({ error: built.error }, 400);
    attributedBody = built.value;
  }
  await directory.summaries();
  const result = await bb.sendText(
    chatGuid,
    body.text,
    body.replyToGuid ? { guid: body.replyToGuid, part: body.replyToPart ?? 0 } : undefined,
    attributedBody,
  );
  if (!result.ok) return c.json({ error: result.error }, 502);
  const mapped = mapMessage(result.value, chatGuid, names);
  directory.applyKnownMessage(chatGuid, mapped);
  return c.json(mapped);
});

app.post("/api/chats/:guid/attachment", async (c) => {
  const chatGuid = c.req.param("guid");
  const form = await c.req.formData();
  const file = form.get("attachment");
  if (!(file instanceof File)) return c.json({ error: "missing attachment" }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const caption = (form.get("caption") as string | null)?.trim() || undefined;
  const isAudio = form.get("isAudioMessage") === "true";
  const name = file.name || "attachment";
  await directory.summaries();
  const result = isAudio
    ? await bb.sendAudio(chatGuid, name, bytes)
    : await bb.sendAttachmentWithCaption(chatGuid, name, bytes, caption);
  if (!result.ok) return c.json({ error: result.error }, 502);
  const mapped = mapMessage(result.value, chatGuid, names);
  directory.applyKnownMessage(chatGuid, mapped);
  return c.json(mapped);
});

// Sends a contact card: builds the vCard server-side so neither platform
// needs file APIs, then rides the normal BB attachment path.
app.post("/api/chats/:guid/contact", async (c) => {
  const chatGuid = c.req.param("guid");
  const body = (await c.req.json()) as { name: string; address: string; caption?: string };
  if (!body?.name || !body?.address) return c.json({ error: "name and address required" }, 400);
  const field = body.address.includes("@")
    ? `EMAIL;TYPE=INTERNET:${body.address}`
    : `TEL;TYPE=CELL:${body.address}`;
  const vcf = ["BEGIN:VCARD", "VERSION:3.0", `FN:${body.name}`, `N:${body.name};;;;`, field, "END:VCARD", ""].join(
    "\r\n",
  );
  const filename = `${body.name.replace(/[^\w -]/g, "").trim() || "Contact"}.vcf`;
  await directory.summaries();
  const result = await bb.sendAttachmentWithCaption(
    chatGuid,
    filename,
    new TextEncoder().encode(vcf),
    body.caption?.trim() || undefined,
  );
  if (!result.ok) return c.json({ error: result.error }, 502);
  const mapped = mapMessage(result.value, chatGuid, names);
  directory.applyKnownMessage(chatGuid, mapped);
  return c.json(mapped);
});

app.post("/api/chats/:guid/read", async (c) => {
  // Mark every service-sibling read so no stale badge lingers on a merged chat.
  const results = await Promise.all(
    directory.siblingGuids(c.req.param("guid")).map((g) => directory.markRead(g)),
  );
  return c.json({ ok: results.some(Boolean) });
});

app.post("/api/chats/:guid/typing", async (c) => {
  if (!bb.hasPrivateApi) return c.json({ ok: false });
  const body = (await c.req.json().catch(() => ({ active: true }))) as { active?: boolean };
  const result = await bb.setTyping(c.req.param("guid"), body.active !== false);
  return c.json({ ok: result.ok });
});

app.post("/api/chats/:guid/unread", async (c) => {
  directory.markUnread(c.req.param("guid"));
  return c.json({ ok: true });
});

app.post("/api/chats/:guid/archive", async (c) => {
  const body = (await c.req.json()) as { archived: boolean };
  directory.setArchived(c.req.param("guid"), body.archived);
  return c.json({ ok: true });
});

app.post("/api/chats/:guid/dismiss", async (c) => {
  const chatGuid = c.req.param("guid");
  const body = (await c.req.json()) as {
    kind?: string;
    expectedLatestMessageGuid?: string;
  };
  if (body.kind !== "unresponded" && body.kind !== "waiting") {
    return c.json({ error: "invalid dismiss kind" }, 400);
  }
  if (body.expectedLatestMessageGuid !== undefined && !body.expectedLatestMessageGuid.trim()) {
    return c.json({ error: "expectedLatestMessageGuid must be non-empty" }, 400);
  }
  const result = await directory.dismiss(chatGuid, body.kind, body.expectedLatestMessageGuid);
  if (!result.ok) return c.json({ error: result.error }, result.status ?? 502);
  return c.json({ ok: true });
});

app.post("/api/chats/:guid/undismiss", async (c) => {
  const body = (await c.req.json()) as { kind?: string };
  if (body.kind !== "unresponded" && body.kind !== "waiting") {
    return c.json({ error: "invalid dismiss kind" }, 400);
  }
  const result = await directory.undismiss(c.req.param("guid"), body.kind);
  if (!result.ok) return c.json({ error: result.error }, result.status ?? 502);
  return c.json({ ok: true });
});

app.post("/api/chats/:guid/later", async (c) => {
  const body = (await c.req.json()) as { until?: number | null };
  if (body.until !== null && (typeof body.until !== "number" || !Number.isFinite(body.until))) {
    return c.json({ error: "until must be an epoch-ms number or null" }, 400);
  }
  const until = body.until ?? null;
  if (until !== null && until <= Date.now()) return c.json({ error: "until must be in the future" }, 400);
  const result = await directory.setLater(c.req.param("guid"), until);
  if (!result.ok) return c.json({ error: result.error }, result.status ?? 502);
  return c.json({ ok: true });
});

app.get("/api/triage/stats", async (c) => {
  const result = await directory.triageStats();
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json(result.value);
});

app.post("/api/chats/:guid/pin", async (c) => {
  const body = (await c.req.json()) as { pinned: boolean };
  directory.setPinned(c.req.param("guid"), body.pinned);
  return c.json({ ok: true });
});

app.post("/api/chats/:guid/mute", async (c) => {
  const body = (await c.req.json()) as { muted: boolean };
  directory.setMutedUnresponded(c.req.param("guid"), body.muted);
  return c.json({ ok: true });
});

app.post("/api/messages/:guid/react", async (c) => {
  const messageGuid = c.req.param("guid");
  const body = (await c.req.json()) as {
    chatGuid: string;
    reaction: string;
    remove?: boolean;
    partIndex?: number;
    suggested?: boolean;
  };
  if (!bb.hasPrivateApi) return c.json({ error: "private API disabled on BlueBubbles" }, 501);
  const partIndex = body.partIndex ?? 0;
  if (partIndex !== 0) return c.json({ error: "message part is not reactable" }, 400);
  const current = await bb.messageWithReactions(messageGuid);
  if (!current.ok) return c.json({ error: current.error }, 502);
  const rawTarget = current.value.find((message) => message.guid === messageGuid);
  const allowedChats = directory.siblingGuids(body.chatGuid);
  if (!rawTarget || !messageBelongsToAnyChat(rawTarget, allowedChats)) {
    return c.json({ error: "reaction target is not valid in this chat" }, 400);
  }
  const target = buildThread(current.value, body.chatGuid, names).find((message) => message.guid === messageGuid);
  if (!target || (body.suggested && target.isFromMe)) {
    return c.json({ error: "reaction target is not valid in this chat" }, 400);
  }
  const alreadyActive = target.reactions.some((reaction) => reaction.isFromMe && reaction.type === body.reaction);
  // Desired-state idempotence closes the BlueBubbles write→read race without
  // turning a duplicate suggestion into a removal or flashing a false failure.
  if (!body.remove && alreadyActive) return c.json({ ok: true });
  if (body.remove && !alreadyActive) return c.json({ ok: true });
  const reaction = body.remove ? `-${body.reaction}` : body.reaction;
  const result = await bb.react(body.chatGuid, messageGuid, reaction, partIndex);
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json({ ok: true });
});

app.get("/api/chats/find", async (c) => {
  const address = c.req.query("address") ?? "";
  const service = c.req.query("service");
  if (!address) return c.json({ error: "address required" }, 400);
  if (service && service !== "iMessage") return c.json({ error: "unsupported service" }, 400);
  const preferredService = service === "iMessage" ? "iMessage" : undefined;
  const summaries = await directory.summaries();
  if (!summaries.ok) return c.json({ error: summaries.error }, 502);
  const chat = await directory.findByAddress(address, preferredService);
  if (!chat) return c.json({ error: "no conversation" }, 404);
  return c.json(chat);
});

app.post("/api/messages/:guid/unsend", async (c) => {
  if (!bb.hasPrivateApi) return c.json({ error: "private API disabled" }, 501);
  const result = await bb.unsend(c.req.param("guid"));
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json({ ok: true });
});

// "Remove for you": deletes the message locally (Mac's Messages database),
// not for the other side. The message lives in ONE of the merged
// conversation's service-sibling chats — try each until one accepts.
app.post("/api/messages/:guid/delete", async (c) => {
  if (!bb.hasPrivateApi) return c.json({ error: "private API disabled" }, 501);
  const body = (await c.req.json()) as { chatGuid: string };
  let lastError = "delete failed";
  for (const guid of directory.siblingGuids(body.chatGuid)) {
    const result = await bb.deleteMessage(guid, c.req.param("guid"));
    if (result.ok) {
      directory.invalidate();
      return c.json({ ok: true });
    }
    lastError = result.error;
  }
  return c.json({ error: lastError }, 502);
});

app.post("/api/messages/:guid/edit", async (c) => {
  if (!bb.hasPrivateApi) return c.json({ error: "private API disabled" }, 501);
  const body = (await c.req.json()) as { text: string };
  if (!body.text?.trim()) return c.json({ error: "text required" }, 400);
  const result = await bb.edit(c.req.param("guid"), body.text.trim());
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json({ ok: true });
});

const CONTACTS_LIMIT = 25;

app.get("/api/contacts", async (c) => {
  await contacts.refresh();
  const q = c.req.query("q") ?? "";
  // Union of the Identity Mirror (Convex names — nickname, rename, org,
  // first/last) and ContactBook (Apple contacts not yet synced into
  // Convex), deduped by address, mirror hits preferred on a collision since
  // Convex is the fresher/canonical name. This is what makes a renamed
  // person ("Uncle Jimmy", searched as "Jimmy Sciandra") surface as a
  // contact even though Apple Contacts still has the old name. `is_favorite`
  // rides along from the mirror's per-person CRM; ContactBook-only hits
  // (Apple contacts not yet synced into Convex) simply omit it.
  const seen = new Set<string>();
  const results: Contact[] = [];
  for (const hit of [...identity.search(q, CONTACTS_LIMIT), ...contacts.search(q, CONTACTS_LIMIT)]) {
    const key = hit.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(hit);
    if (results.length >= CONTACTS_LIMIT) break;
  }
  return c.json(results);
});

app.post("/api/chats/new", async (c) => {
  const body = (await c.req.json()) as { addresses: string[]; text: string };
  const textError = outboundTextError(body.text);
  const addressesError = outboundAddressesError(body.addresses ?? []);
  if (addressesError || textError) {
    return c.json({ error: textError ?? addressesError }, 400);
  }
  const result = await bb.createChat(body.addresses, body.text);
  if (!result.ok) return c.json({ error: result.error }, 502);
  const sent = result.value.lastMessage;
  if (!sent) return c.json({ error: "created chat has no sent message" }, 502);
  const chatError = createdChatError(result.value, body.addresses, sent);
  if (chatError) return c.json({ error: chatError }, 502);
  const participants = result.value.participants ?? [];
  const message = mapMessage(sent, result.value.guid, names, participants);
  if (!message.isFromMe || message.text !== body.text || message.service !== "iMessage" || message.error !== 0) {
    return c.json({ error: "created chat returned an invalid sent message" }, 502);
  }
  directory.applyKnownMessage(result.value.guid, message);
  broadcast({ kind: "chats-changed" });
  return c.json({
    chatGuid: result.value.guid,
    service: "iMessage",
    isGroup: body.addresses.length > 1,
    participants: participants.map((participant) => participant.address),
    message,
  });
});

app.get("/api/search", async (c) => {
  const chatGuid = c.req.query("chat") || undefined;
  const fromQ = c.req.query("from");
  const from = fromQ === "me" || fromQ === "them" ? fromQ : undefined;
  return c.json(await search.search(c.req.query("q") ?? "", { chatGuid, from }));
});

// ------------------------------------------------------------- media gallery

app.get("/api/chats/:guid/gallery", async (c) => {
  const chatGuid = c.req.param("guid");
  const items: import("../shared/types").GalleryItem[] = [];
  const seen = new Set<string>();
  // Walk back through recent windows collecting attachments.
  let before: number | undefined;
  for (let page = 0; page < 8 && items.length < 120; page++) {
    const batch = await bb.chatMessages(chatGuid, { limit: 200, before, sort: "DESC" });
    if (!batch.ok || batch.value.length === 0) break;
    for (const m of batch.value) {
      for (const a of m.attachments ?? []) {
        if (!a.guid || a.hideAttachment || seen.has(a.guid)) continue;
        const mime = a.mimeType ?? "";
        const isImage = mime.startsWith("image/");
        const isVideo = mime.startsWith("video/");
        if (!isImage && !isVideo) continue;
        seen.add(a.guid);
        items.push({
          guid: a.guid,
          mimeType: a.mimeType ?? null,
          filename: a.transferName ?? null,
          isImage,
          isVideo,
          dateCreated: m.dateCreated ?? 0,
        });
      }
    }
    before = batch.value[batch.value.length - 1]?.dateCreated;
    if (!before) break;
  }
  return c.json(items);
});

// -------------------------------------------------------------- FaceTime

app.post("/api/chats/:guid/facetime-link", async (c) => {
  if (!bb.hasPrivateApi) return c.json({ error: "private API disabled" }, 501);
  const chatGuid = c.req.param("guid");
  const result = await createAndSendFaceTimeLink(bb, chatGuid);
  if (!result.ok) return c.json({ error: result.error }, 502);
  const message = mapMessage(result.value, chatGuid, names);
  directory.applyKnownMessage(chatGuid, message);
  broadcast({ kind: "new-message", chatGuid, message });
  return c.json({ message });
});

// ----------------------------------------------------------- group / delete

app.get("/api/chats/:guid/info", async (c) => {
  const chat = await bb.getChat(c.req.param("guid"));
  if (!chat.ok) return c.json({ error: chat.error }, 502);
  await contacts.refresh();
  const participants = (chat.value.participants ?? []).map((p) => ({
    address: p.address,
    name: names.lookup(p.address),
  }));
  return c.json({
    guid: chat.value.guid,
    displayName: chat.value.displayName ?? null,
    isGroup: (chat.value.participants ?? []).length > 1 || chat.value.guid.includes(";+;"),
    participants,
  });
});

app.post("/api/chats/:guid/rename", async (c) => {
  if (!bb.hasPrivateApi) return c.json({ error: "private API disabled" }, 501);
  const body = (await c.req.json()) as { name: string };
  const result = await bb.renameGroup(c.req.param("guid"), body.name ?? "");
  if (!result.ok) return c.json({ error: result.error }, 502);
  directory.invalidate();
  return c.json({ ok: true });
});

app.post("/api/chats/:guid/participant", async (c) => {
  if (!bb.hasPrivateApi) return c.json({ error: "private API disabled" }, 501);
  const body = (await c.req.json()) as { address: string; action: "add" | "remove" };
  const result =
    body.action === "remove"
      ? await bb.removeParticipant(c.req.param("guid"), body.address)
      : await bb.addParticipant(c.req.param("guid"), body.address);
  if (!result.ok) return c.json({ error: result.error }, 502);
  directory.invalidate();
  return c.json({ ok: true });
});

app.post("/api/chats/:guid/leave", async (c) => {
  if (!bb.hasPrivateApi) return c.json({ error: "private API disabled" }, 501);
  const result = await bb.leaveGroup(c.req.param("guid"));
  if (!result.ok) return c.json({ error: result.error }, 502);
  directory.invalidate();
  return c.json({ ok: true });
});

app.post("/api/chats/:guid/delete", async (c) => {
  const chatGuid = c.req.param("guid");
  const result = await bb.deleteChat(chatGuid);
  if (!result.ok) return c.json({ error: result.error }, 502);
  db.deleteSuggestionFeedbackForChat(chatGuid);
  directory.invalidate();
  broadcast({ kind: "chats-changed" });
  return c.json({ ok: true });
});

// -------------------------------------------------------- scheduled messages

async function scheduledChatNames(): Promise<Map<string, string>> {
  const result = await directory.summaries();
  return new Map(result.ok ? result.chats.map((chat) => [chat.guid, chat.displayName]) : []);
}

app.get("/api/scheduled", async (c) => {
  const [result, namesByGuid] = await Promise.all([
    bb.listScheduledMessages(),
    scheduledChatNames(),
  ]);
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json(
    result.value
      .map((item) => mapScheduledMessage(item, namesByGuid.get(item.payload.chatGuid) ?? item.payload.chatGuid))
      .sort((a, b) => a.sendAt - b.sendAt),
  );
});

app.post("/api/scheduled", async (c) => {
  const body = (await c.req.json()) as { chatGuid: string; text: string; sendAt: number };
  if (!body.chatGuid || !body.text?.trim() || !Number.isFinite(body.sendAt) || body.sendAt <= Date.now()) {
    return c.json({ error: "chatGuid, text, and a future sendAt are required" }, 400);
  }
  const result = await bb.createScheduledMessage(body.chatGuid, body.text.trim(), body.sendAt);
  if (!result.ok) return c.json({ error: result.error }, 502);
  const namesByGuid = await scheduledChatNames();
  return c.json(mapScheduledMessage(result.value, namesByGuid.get(body.chatGuid) ?? body.chatGuid));
});

app.put("/api/scheduled/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = (await c.req.json()) as { chatGuid: string; text: string; sendAt: number };
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "invalid schedule id" }, 400);
  if (!body.chatGuid || !body.text?.trim() || !Number.isFinite(body.sendAt) || body.sendAt <= Date.now()) {
    return c.json({ error: "chatGuid, text, and a future sendAt are required" }, 400);
  }
  const result = await bb.updateScheduledMessage(id, body.chatGuid, body.text.trim(), body.sendAt);
  if (!result.ok) return c.json({ error: result.error }, 502);
  const namesByGuid = await scheduledChatNames();
  return c.json(mapScheduledMessage(result.value, namesByGuid.get(body.chatGuid) ?? body.chatGuid));
});

app.delete("/api/scheduled/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "invalid schedule id" }, 400);
  const result = await bb.deleteScheduledMessage(id);
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json({ ok: true });
});

app.post("/api/scheduled/:id/send-now", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "invalid schedule id" }, 400);
  const result = await scheduledSendNow.send(id);
  if (!result.ok) {
    const status = result.error.includes("not found") || result.error.includes("claimed") ? 409 : 502;
    return c.json({ error: result.error }, status);
  }
  return c.json({ ok: true });
});

// ------------------------------------------------ transcription / attachments

app.get("/api/attachments/:guid/transcript", (c) => {
  return c.json(whisper.state(c.req.param("guid")), 200, { "Cache-Control": "no-store" });
});

app.post("/api/attachments/:guid/transcript", (c) => {
  return c.json(whisper.request(c.req.param("guid")), 202, { "Cache-Control": "no-store" });
});

type AttachmentFile = ReturnType<typeof Bun.file>;
const rangeDownloads = new Map<string, Promise<AttachmentFile | null>>();

function attachmentSourcePath(guid: string): string {
  const safeGuid = guid.replace(/[^A-Za-z0-9-]/g, "_");
  return `.cache/attachments/${safeGuid}.source`;
}

function attachmentHeaders(contentType: string | null): Headers {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
  });
  if (contentType) headers.set("Content-Type", contentType);
  return headers;
}

function attachmentFileResponse(
  file: AttachmentFile,
  contentType: string | null,
  rangeHeader: string | null,
): Response {
  const headers = attachmentHeaders(contentType);
  const range = parseByteRange(rangeHeader, file.size);

  if (range.kind === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${file.size}`);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }

  if (range.kind === "partial") {
    const length = range.end - range.start + 1;
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`);
    headers.set("Content-Length", String(length));
    return new Response(file.slice(range.start, range.end + 1), { status: 206, headers });
  }

  headers.set("Content-Length", String(file.size));
  return new Response(file, { headers });
}

async function cachedAttachmentFile(guid: string): Promise<AttachmentFile | null> {
  const path = attachmentSourcePath(guid);
  const cached = Bun.file(path);
  if (await cached.exists()) return cached;

  const active = rangeDownloads.get(guid);
  if (active) return active;

  // BlueBubbles ignores Range, so cache its one full download and slice locally.
  const pending = (async () => {
    const download = await bb.downloadAttachment(guid);
    if (!download.ok || !download.body) return null;
    await Bun.write(path, await download.arrayBuffer());
    return Bun.file(path);
  })();
  rangeDownloads.set(guid, pending);
  try {
    return await pending;
  } finally {
    rangeDownloads.delete(guid);
  }
}

app.get("/api/attachments/:guid", async (c) => {
  const guid = c.req.param("guid");
  const rangeHeader = c.req.header("Range") ?? null;
  const meta = await bb.attachmentMeta(guid);
  const mimeType = meta.ok ? (meta.value.mimeType ?? null) : null;
  const filename = meta.ok ? (meta.value.transferName ?? null) : null;

  const transcoded = await transcodeAttachment(guid, mimeType, filename, () =>
    bb.downloadAttachment(guid),
  );
  if (transcoded) {
    return attachmentFileResponse(Bun.file(transcoded.path), transcoded.contentType, rangeHeader);
  }

  const cached = Bun.file(attachmentSourcePath(guid));
  if (await cached.exists()) return attachmentFileResponse(cached, mimeType, rangeHeader);

  if (rangeHeader) {
    const file = await cachedAttachmentFile(guid);
    if (!file) return c.json({ error: "download failed" }, 502);
    return attachmentFileResponse(file, mimeType, rangeHeader);
  }

  const download = await bb.downloadAttachment(guid);
  if (!download.ok || !download.body) return c.json({ error: "download failed" }, 502);
  return new Response(download.body, {
    headers: attachmentHeaders(mimeType ?? download.headers.get("Content-Type")),
  });
});

// ------------------------------------------------------------------- ai
// Every model call originates here so the gateway key never reaches a client.
console.log(
  `AI: harness lane ${shadowStatus.available ? "on" : `off (${shadowStatus.detail})`}, direct lane ${ai.available ? "on" : "off"}`,
);

app.get("/api/ai/status", async (c) => {
  return c.json({
    suggestions: ai.available,
    reactionSuggestions: bb.hasPrivateApi,
    shadow: shadowStatus.available,
    shadowDetail: shadowStatus.detail,
  });
});

app.post("/api/ai/group-name/:guid", async (c) => {
  const chatGuid = c.req.param("guid");
  const chat = await bb.getChat(chatGuid);
  if (!chat.ok) return c.json({ error: chat.error }, 502);
  await contacts.refresh();
  const participants = (chat.value.participants ?? []).map(
    (p) => names.lookup(p.address) ?? p.address,
  );
  const result = await ai.groupNames(chatGuid, participants);
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json({ names: result.value.filter((n) => typeof n === "string").slice(0, 5) });
});

app.get("/api/ai/suggestions/:guid", async (c) => {
  const chatGuid = c.req.param("guid");
  const result = await ai.replySuggestions(
    chatGuid,
    await peerNameOf(chatGuid),
    c.req.query("refresh") === "1",
    parseSuggestionModel(c.req.query("model")),
  );
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json(result.value);
});

app.post("/api/ai/suggestions/:guid/feedback", async (c) => {
  const request = await c.req.json<SuggestionFeedbackRequest>();
  const result = request.suggestion.kind === "reaction"
    ? (ai.recordReactionFeedback(c.req.param("guid"), request), { ok: true as const, value: true })
    : ai.recordSuggestionFeedback(c.req.param("guid"), request);
  return result.ok ? c.json({ ok: true }) : c.json({ error: result.error }, 400);
});

app.delete("/api/ai/suggestions/learning", (c) => {
  ai.clearSuggestionLearning();
  return c.json({ ok: true });
});

app.get("/api/ai/identify/:guid", async (c) => {
  const chatGuid = c.req.param("guid");
  const chat = await bb.getChat(chatGuid);
  if (!chat.ok) return c.json({ error: chat.error }, 502);
  const address = chat.value.participants?.[0]?.address;
  if (!address) return c.json({ error: "no participant address" }, 400);
  await contacts.refresh();
  const result = await ai.identify(chatGuid, address, names.lookup(address));
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json(result.value);
});

app.get("/api/chats/:guid/smart-closer", async (c) => {
  const result = await ai.smartCloser(c.req.param("guid"));
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json(result.value);
});

app.get("/api/chats/:guid/shadow-brief", async (c) => {
  const result = await ai.shadowBrief(c.req.param("guid"), c.req.query("regenerate") === "1");
  if (!result.ok) return c.json({ error: result.error }, result.error === "chat has no messages" ? 404 : 502);
  return c.json(result.value);
});

app.get("/api/ai/shadow/:guid", async (c) => {
  const chatGuid = c.req.param("guid");
  return c.json({
    messages: db.listShadowMessages(chatGuid).map((row) => ({
      id: row.id,
      role: row.role,
      text: row.text,
      createdAt: row.created_at,
    })),
    // The client polls this to know a fired turn is still running server-side,
    // so the reply lands even if the panel was closed and reopened.
    pending: ai.shadowPending(chatGuid),
  });
});

app.post("/api/ai/shadow/:guid", async (c) => {
  const chatGuid = c.req.param("guid");
  const body = (await c.req.json()) as { text?: string };
  if (!body.text?.trim()) return c.json({ error: "text required" }, 400);
  // Persist the user turn and kick the delegate before returning, so the very
  // next poll sees the message and pending=true. The delegate itself runs to
  // completion server-side regardless of whether the client is still around.
  const peer = await peerNameOf(chatGuid);
  ai.shadowEnqueue(chatGuid, body.text.trim(), peer);
  return c.json({ ok: true, pending: true }, 202);
});

app.delete("/api/ai/shadow/:guid", async (c) => {
  db.clearShadowMessages(c.req.param("guid"));
  return c.json({ ok: true });
});

function parseSuggestionModel(value: string | undefined): SuggestionModel {
  return value === "terra" ? "terra" : "opus";
}

/** Display name for a DM's counterpart, used to address suggestions properly. */
async function peerNameOf(chatGuid: string): Promise<string | null> {
  const result = await directory.summaries();
  if (!result.ok) return null;
  const chat = result.chats.find((ch) => ch.guid === chatGuid);
  if (!chat || chat.isGroup) return null;
  return chat.displayName ?? null;
}

app.get("/events", (c) => {
  return streamSSE(c, async (stream) => {
    const id = ++sseClientId;
    const client: SSEClient = {
      id,
      send: (event) => {
        void stream.writeSSE({ data: JSON.stringify(event) });
      },
    };
    sseClients.add(client);
    stream.onAbort(() => {
      sseClients.delete(client);
    });
    // keepalive comments so proxies don't drop the connection
    while (sseClients.has(client)) {
      await stream.writeSSE({ event: "ping", data: String(Date.now()) });
      await stream.sleep(25_000);
    }
  });
});

deps.configureFixtureRoutes?.(app, { broadcast, directory });

// Unknown API paths must remain API 404s instead of falling through to the
// SPA shell, which would turn a client typo into a misleading 200 HTML reply.
app.get("/api/*", (c) => c.json({ error: "Not found" }, 404));

// -------------------------------------------------------------- static app
// The universal Expo web export. Expo static output has one HTML file per
// route, so dynamic segments need explicit rewrites.

app.use(
  "/*",
  serveStatic({
    root: staticRoot,
    onFound: (_path, c) => {
      c.header("Cache-Control", staticCacheControl(c.req.path));
    },
  }),
);
app.get(
  "*",
  serveStatic({
    root: staticRoot,
    rewriteRequestPath: () => "/index.html",
    onFound: (_path, c) => {
      c.header("Cache-Control", "no-store");
    },
  }),
);

return {
  app,
  dispose: () => {
    if (reconnectTimer) clearInterval(reconnectTimer);
    identity.stop();
  },
};
}
