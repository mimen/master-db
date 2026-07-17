import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";
import { io } from "socket.io-client";
import type { BBMessage } from "./bb-types";
import { BlueBubblesClient } from "./bluebubbles";
import { loadConfig } from "./config";
import { ContactBook } from "./contacts";
import { OverlayDb } from "./db";
import { matchesFilters } from "./filters";
import { fetchLinkPreview } from "./link-preview";
import { buildThread, mapChat, mapMessage } from "./map";
import { transcodeAttachment } from "./transcode";
import type { ServerEvent, StateFilter, TypeFilter } from "../shared/types";

const config = loadConfig();
const bb = new BlueBubblesClient(config.bbUrl, config.bbPassword);
const db = new OverlayDb(config.dbPath);
const contacts = new ContactBook(bb);

const info = await bb.connect();
if (!info.ok) {
  console.error(`Cannot reach BlueBubbles at ${config.bbUrl}: ${info.error}`);
} else {
  console.log(
    `BlueBubbles ${info.value.server_version ?? "?"} connected, private API: ${bb.hasPrivateApi}`,
  );
}
await contacts.refresh(true);

// Re-check server info periodically so a BlueBubbles restart or private-API
// toggle is picked up without restarting this service.
setInterval(() => void bb.connect(), 5 * 60_000);

// ---------------------------------------------------------------- SSE fanout

type SSEClient = { id: number; send: (event: ServerEvent) => void };
const sseClients = new Set<SSEClient>();
let sseClientId = 0;

function broadcast(event: ServerEvent): void {
  for (const client of sseClients) client.send(event);
}

// ------------------------------------------------- BlueBubbles socket events

function chatGuidOf(message: BBMessage): string | null {
  return message.chats?.[0]?.guid ?? null;
}

const socket = io(config.bbUrl, {
  query: { guid: config.bbPassword, password: config.bbPassword },
  transports: ["websocket"],
  reconnection: true,
  reconnectionDelayMax: 30_000,
});

socket.on("connect", () => console.log("socket.io connected to BlueBubbles"));
socket.on("connect_error", (err: Error) => console.error("socket.io error:", err.message));

function onMessageEvent(kind: "new-message" | "updated-message") {
  return (payload: BBMessage) => {
    const chatGuid = chatGuidOf(payload);
    if (!chatGuid) {
      broadcast({ kind: "chats-changed" });
      return;
    }
    broadcast({ kind, chatGuid, message: mapMessage(payload, chatGuid, contacts) });
  };
}

socket.on("new-message", onMessageEvent("new-message"));
socket.on("updated-message", onMessageEvent("updated-message"));
socket.on("chat-read-status-changed", () => broadcast({ kind: "chats-changed" }));
socket.on("typing-indicator", (payload: { display: boolean; guid: string }) => {
  broadcast({ kind: "typing", chatGuid: payload.guid, display: payload.display });
});
for (const event of ["group-name-change", "participant-added", "participant-removed", "participant-left"]) {
  socket.on(event, () => broadcast({ kind: "chats-changed" }));
}

// ------------------------------------------------------------------- routes

// ------------------------------------------------------- unread count scan

const UNREAD_TTL_MS = 30_000;
let unreadScan: { at: number; counts: Map<string, number> } = { at: 0, counts: new Map() };

async function unreadCounts(): Promise<Map<string, number>> {
  if (Date.now() - unreadScan.at < UNREAD_TTL_MS) return unreadScan.counts;
  const counts = new Map<string, number>();
  const batch = await bb.queryMessages({ limit: 1000, offset: 0 });
  if (batch.ok) {
    for (const message of batch.value) {
      if (message.isFromMe === true || message.dateRead) continue;
      if (message.associatedMessageGuid && message.associatedMessageType) continue;
      if ((message.itemType ?? 0) !== 0 || (message.groupActionType ?? 0) !== 0) continue;
      const chatGuid = message.chats?.[0]?.guid;
      if (!chatGuid) continue;
      counts.set(chatGuid, (counts.get(chatGuid) ?? 0) + 1);
    }
    unreadScan = { at: Date.now(), counts };
  }
  return counts;
}

const app = new Hono();

app.onError((err, c) => {
  console.error(`${c.req.method} ${c.req.path}:`, err.message);
  return c.json({ error: err.message }, 500);
});

app.get("/api/health", async (c) => {
  return c.json({ ok: true, privateApi: bb.hasPrivateApi });
});

app.get("/api/chats", async (c) => {
  const state = (c.req.query("state") ?? "all") as StateFilter;
  const type = (c.req.query("type") ?? "all") as TypeFilter;
  const result = await bb.queryChats();
  if (!result.ok) return c.json({ error: result.error }, 502);
  await contacts.refresh();
  const unread = await unreadCounts();
  const overlay = db.getAll();
  const chats = result.value
    .map((chat) => {
      const summary = mapChat(chat, overlay.get(chat.guid), contacts, unread.get(chat.guid));
      // Mark-read override: trust our own recent mark-read over BB's lagging DB.
      const readAt = localReadAt.get(chat.guid);
      if (readAt && (summary.lastMessage?.dateCreated ?? 0) <= readAt) {
        summary.unreadCount = 0;
        summary.flags.unread = false;
      }
      return summary;
    })
    .filter((chat) => chat.lastMessage !== null)
    .filter((chat) => matchesFilters(chat, state, type))
    .sort((a, b) => (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0));
  return c.json(chats);
});

app.get("/api/chats/:guid/messages", async (c) => {
  const chatGuid = c.req.param("guid");
  const before = c.req.query("before");
  const after = c.req.query("after");
  const around = c.req.query("around");

  if (around) {
    // Jump-to-message: fetch a window on both sides of the target timestamp.
    const target = Number(around);
    const [older, newer] = await Promise.all([
      bb.chatMessages(chatGuid, { before: target + 1, limit: 40, sort: "DESC" }),
      bb.chatMessages(chatGuid, { after: target, limit: 40, sort: "ASC" }),
    ]);
    if (!older.ok) return c.json({ error: older.error }, 502);
    const merged = new Map((newer.ok ? newer.value : []).map((m) => [m.guid, m]));
    for (const m of older.value) merged.set(m.guid, m);
    return c.json(buildThread([...merged.values()], chatGuid, contacts));
  }

  const result = await bb.chatMessages(chatGuid, {
    before: before ? Number(before) : undefined,
    after: after ? Number(after) : undefined,
    sort: after ? "ASC" : "DESC",
  });
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json(buildThread(result.value, chatGuid, contacts));
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
  if (!b64) return c.body(null, 404);
  const bytes = Buffer.from(b64, "base64");
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  return new Response(new Uint8Array(bytes), {
    headers: { ...headers, "Content-Type": isPng ? "image/png" : "image/jpeg" },
  });
});

const groupPhotoCache = new Map<string, { at: number; photoGuid: string | null }>();

app.get("/api/chats/:guid/photo", async (c) => {
  const guid = c.req.param("guid");
  let cached = groupPhotoCache.get(guid);
  if (!cached || Date.now() - cached.at > 10 * 60 * 1000) {
    const chat = await bb.getChat(guid);
    cached = {
      at: Date.now(),
      photoGuid: chat.ok ? (chat.value.properties?.[0]?.groupPhotoGuid ?? null) : null,
    };
    groupPhotoCache.set(guid, cached);
  }
  const photoGuid = cached.photoGuid;
  if (!photoGuid) return c.body(null, 404);
  const download = await bb.downloadAttachment(photoGuid);
  if (!download.ok || !download.body) return c.body(null, 404);
  return new Response(download.body, {
    headers: { "Cache-Control": "private, max-age=3600" },
  });
});

app.get("/api/link-preview", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ error: "url required" }, 400);
  return c.json(await fetchLinkPreview(url));
});

app.post("/api/chats/:guid/send", async (c) => {
  const chatGuid = c.req.param("guid");
  const body = (await c.req.json()) as { text: string; replyToGuid?: string; replyToPart?: number };
  if (!body.text?.trim()) return c.json({ error: "empty message" }, 400);
  const result = await bb.sendText(
    chatGuid,
    body.text,
    body.replyToGuid ? { guid: body.replyToGuid, part: body.replyToPart ?? 0 } : undefined,
  );
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json(mapMessage(result.value, chatGuid, contacts));
});

app.post("/api/chats/:guid/attachment", async (c) => {
  const chatGuid = c.req.param("guid");
  const form = await c.req.formData();
  const file = form.get("attachment");
  if (!(file instanceof File)) return c.json({ error: "missing attachment" }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await bb.sendAttachment(chatGuid, file.name || "attachment", bytes);
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json(mapMessage(result.value, chatGuid, contacts));
});

// Chats we've marked read, ahead of BlueBubbles' DB reflecting it.
const localReadAt = new Map<string, number>();

app.post("/api/chats/:guid/read", async (c) => {
  const guid = c.req.param("guid");
  const result = await bb.markRead(guid);
  if (result.ok) {
    localReadAt.set(guid, Date.now());
    unreadScan.counts.set(guid, 0);
    broadcast({ kind: "chats-changed" });
  }
  return c.json({ ok: result.ok });
});

app.post("/api/chats/:guid/archive", async (c) => {
  const body = (await c.req.json()) as { archived: boolean };
  db.setArchived(c.req.param("guid"), body.archived);
  broadcast({ kind: "chats-changed" });
  return c.json({ ok: true });
});

app.post("/api/chats/:guid/dismiss", async (c) => {
  const chatGuid = c.req.param("guid");
  const body = (await c.req.json()) as { kind: "unresponded" | "waiting" };
  const result = await bb.queryChats(1000);
  if (!result.ok) return c.json({ error: result.error }, 502);
  const chat = result.value.find((x) => x.guid === chatGuid);
  const lastGuid = chat?.lastMessage?.guid;
  if (!lastGuid) return c.json({ error: "chat has no last message" }, 404);
  if (body.kind === "unresponded") db.dismissUnresponded(chatGuid, lastGuid);
  else db.dismissWaiting(chatGuid, lastGuid);
  broadcast({ kind: "chats-changed" });
  return c.json({ ok: true });
});

app.post("/api/chats/:guid/mute", async (c) => {
  const body = (await c.req.json()) as { muted: boolean };
  db.setMutedUnresponded(c.req.param("guid"), body.muted);
  broadcast({ kind: "chats-changed" });
  return c.json({ ok: true });
});

app.post("/api/messages/:guid/react", async (c) => {
  const messageGuid = c.req.param("guid");
  const body = (await c.req.json()) as {
    chatGuid: string;
    reaction: string;
    remove?: boolean;
    partIndex?: number;
  };
  if (!bb.hasPrivateApi) return c.json({ error: "private API disabled on BlueBubbles" }, 501);
  const reaction = body.remove ? `-${body.reaction}` : body.reaction;
  const result = await bb.react(body.chatGuid, messageGuid, reaction, body.partIndex ?? 0);
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json({ ok: true });
});

app.get("/api/contacts", async (c) => {
  await contacts.refresh();
  return c.json(contacts.search(c.req.query("q") ?? "", 25));
});

app.post("/api/chats/new", async (c) => {
  const body = (await c.req.json()) as { addresses: string[]; text: string };
  if (!body.addresses?.length || !body.text?.trim()) {
    return c.json({ error: "addresses and text required" }, 400);
  }
  const result = await bb.createChat(body.addresses, body.text);
  if (!result.ok) return c.json({ error: result.error }, 502);
  broadcast({ kind: "chats-changed" });
  return c.json({ chatGuid: result.value.guid });
});

app.get("/api/search", async (c) => {
  const q = (c.req.query("q") ?? "").toLowerCase();
  if (q.length < 2) return c.json([]);
  const found: BBMessage[] = [];
  for (let offset = 0; offset < 3000 && found.length < 50; offset += 1000) {
    const batch = await bb.queryMessages({ limit: 1000, offset });
    if (!batch.ok) break;
    for (const message of batch.value) {
      if ((message.text ?? "").toLowerCase().includes(q)) found.push(message);
    }
    if (batch.value.length < 1000) break;
  }
  return c.json(
    found
      .slice(0, 50)
      .map((m) => mapMessage(m, m.chats?.[0]?.guid ?? "", contacts)),
  );
});

app.get("/api/attachments/:guid", async (c) => {
  const guid = c.req.param("guid");
  const meta = await bb.attachmentMeta(guid);
  const mimeType = meta.ok ? (meta.value.mimeType ?? null) : null;
  const filename = meta.ok ? (meta.value.transferName ?? null) : null;

  const transcoded = await transcodeAttachment(guid, mimeType, filename, () =>
    bb.downloadAttachment(guid),
  );
  if (transcoded) {
    return new Response(Bun.file(transcoded.path), {
      headers: {
        "Content-Type": transcoded.contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  }

  const download = await bb.downloadAttachment(guid);
  if (!download.ok || !download.body) return c.json({ error: "download failed" }, 502);
  const headers = new Headers({ "Cache-Control": "private, max-age=86400" });
  if (mimeType) headers.set("Content-Type", mimeType);
  return new Response(download.body, { headers });
});

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

// -------------------------------------------------------------- static SPA

app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));

export default {
  port: config.port,
  idleTimeout: 120,
  fetch: app.fetch,
};

console.log(`imsg server on :${config.port}`);
