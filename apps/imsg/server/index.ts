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
import { buildThread, mapChat, mapMessage } from "./map";
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
  const overlay = db.getAll();
  const chats = result.value
    .map((chat) => mapChat(chat, overlay.get(chat.guid), contacts))
    .filter((chat) => chat.lastMessage !== null)
    .filter((chat) => matchesFilters(chat, state, type))
    .sort((a, b) => (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0));
  return c.json(chats);
});

app.get("/api/chats/:guid/messages", async (c) => {
  const chatGuid = c.req.param("guid");
  const before = c.req.query("before");
  const result = await bb.chatMessages(chatGuid, {
    before: before ? Number(before) : undefined,
  });
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json(buildThread(result.value, chatGuid, contacts));
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

app.post("/api/chats/:guid/read", async (c) => {
  const result = await bb.markRead(c.req.param("guid"));
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
  const download = await bb.downloadAttachment(guid);
  if (!download.ok || !download.body) return c.json({ error: "download failed" }, 502);
  const headers = new Headers({ "Cache-Control": "private, max-age=86400" });
  if (meta.ok && meta.value.mimeType) headers.set("Content-Type", meta.value.mimeType);
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
