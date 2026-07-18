import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";
import { io } from "socket.io-client";
import type { BBMessage } from "./bb-types";
import { BlueBubblesClient } from "./bluebubbles";
import { ChatDirectory } from "./chat-directory";
import { loadConfig } from "./config";
import { ContactBook } from "./contacts";
import { OverlayDb } from "./db";
import { GroupPhotos } from "./group-photos";
import { MessageSearch } from "./message-search";
import { computeCounts, matchesFilters } from "../shared/chat-state";
import { fetchLinkPreview } from "./link-preview";
import { buildThread, mapMessage } from "./map";
import { transcodeAttachment } from "./transcode";
import type { ServerEvent, StateFilter, TypeFilter } from "../shared/types";

const config = loadConfig();
const bb = new BlueBubblesClient(config.bbUrl, config.bbPassword);
const db = new OverlayDb(config.dbPath);
const contacts = new ContactBook(bb);
const directory = new ChatDirectory(bb, db, contacts);
const search = new MessageSearch(bb, contacts);
const photos = new GroupPhotos(bb);

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

// Any directory invalidation fans out as a chats-changed event.
directory.onEvent(() => broadcast({ kind: "chats-changed" }));

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
    const mapped = directory.applyMessage(chatGuid, payload);
    if (!chatGuid || mapped === null) {
      broadcast({ kind: "chats-changed" });
      return;
    }
    broadcast({ kind, chatGuid, message: mapped });
  };
}

socket.on("new-message", onMessageEvent("new-message"));
socket.on("updated-message", onMessageEvent("updated-message"));
socket.on("chat-read-status-changed", () => directory.invalidate(true));
socket.on("typing-indicator", (payload: { display: boolean; guid: string }) => {
  broadcast({ kind: "typing", chatGuid: payload.guid, display: payload.display });
});
for (const event of ["group-name-change", "participant-added", "participant-removed", "participant-left"]) {
  socket.on(event, () => directory.invalidate());
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
  const body = (await c.req.json()) as { text: string; replyToGuid?: string; replyToPart?: number };
  if (!body.text?.trim()) return c.json({ error: "empty message" }, 400);
  const result = await bb.sendText(
    chatGuid,
    body.text,
    body.replyToGuid ? { guid: body.replyToGuid, part: body.replyToPart ?? 0 } : undefined,
  );
  if (!result.ok) return c.json({ error: result.error }, 502);
  const mapped = mapMessage(result.value, chatGuid, contacts);
  directory.applyKnownMessage(chatGuid, mapped);
  return c.json(mapped);
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
  const ok = await directory.markRead(c.req.param("guid"));
  return c.json({ ok });
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
  const body = (await c.req.json()) as { kind: "unresponded" | "waiting" };
  const result = await directory.dismiss(chatGuid, body.kind);
  if (!result.ok) return c.json({ error: result.error }, result.status ?? 502);
  return c.json({ ok: true });
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
  };
  if (!bb.hasPrivateApi) return c.json({ error: "private API disabled on BlueBubbles" }, 501);
  const reaction = body.remove ? `-${body.reaction}` : body.reaction;
  const result = await bb.react(body.chatGuid, messageGuid, reaction, body.partIndex ?? 0);
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json({ ok: true });
});

app.get("/api/chats/find", async (c) => {
  const address = c.req.query("address") ?? "";
  if (!address) return c.json({ error: "address required" }, 400);
  const result = await directory.summaries();
  if (!result.ok) return c.json({ error: result.error }, 502);
  const chatGuid = await directory.findByAddress(address);
  if (!chatGuid) return c.json({ error: "no conversation" }, 404);
  return c.json({ chatGuid });
});

app.post("/api/messages/:guid/unsend", async (c) => {
  if (!bb.hasPrivateApi) return c.json({ error: "private API disabled" }, 501);
  const result = await bb.unsend(c.req.param("guid"));
  if (!result.ok) return c.json({ error: result.error }, 502);
  return c.json({ ok: true });
});

app.post("/api/messages/:guid/edit", async (c) => {
  if (!bb.hasPrivateApi) return c.json({ error: "private API disabled" }, 501);
  const body = (await c.req.json()) as { text: string };
  if (!body.text?.trim()) return c.json({ error: "text required" }, 400);
  const result = await bb.edit(c.req.param("guid"), body.text.trim());
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
  return c.json(await search.search(c.req.query("q") ?? ""));
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

// -------------------------------------------------------------- static app
// The universal Expo web export. Expo static output has one HTML file per
// route, so dynamic segments need explicit rewrites.

app.use("/*", serveStatic({ root: "./client/dist" }));
app.get("*", serveStatic({ path: "./client/dist/index.html" }));

export default {
  port: config.port,
  idleTimeout: 120,
  fetch: app.fetch,
};

console.log(`imsg server on :${config.port}`);
