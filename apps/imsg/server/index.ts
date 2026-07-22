import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";
import type { BBMessage } from "./bb-types";
import { BlueBubblesClient } from "./bluebubbles";
import { ChatDirectory } from "./chat-directory";
import { loadConfig } from "./config";
import { ContactBook } from "./contacts";
import { OverlayDb } from "./db";
import { GroupPhotos } from "./group-photos";
import { IdentitySync } from "./identity-sync";
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
const identitySync = new IdentitySync(bb, config);

const info = await bb.connect();
if (!info.ok) {
  console.error(`Cannot reach BlueBubbles at ${config.bbUrl}: ${info.error}`);
} else {
  console.log(
    `BlueBubbles ${info.value.server_version ?? "?"} connected, private API: ${bb.hasPrivateApi}`,
  );
}
await contacts.refresh(true);
identitySync.start();

// Re-check server info periodically so a BlueBubbles restart or private-API
// toggle is picked up without restarting this service.
setInterval(() => void bb.connect(), 5 * 60_000);

// Scheduled-message tick: fire anything due, then drop it from the queue.
setInterval(() => {
  for (const s of db.dueScheduled(Date.now())) {
    void bb
      .sendText(s.chatGuid, s.text)
      .then((result) => {
        db.removeScheduled(s.id);
        if (result.ok) {
          directory.applyKnownMessage(s.chatGuid, mapMessage(result.value, s.chatGuid, contacts));
          broadcast({ kind: "chats-changed" });
        }
      })
      .catch(() => undefined);
  }
}, 20_000);

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

function chatGuidOf(message: BBMessage): string | null {
  return message.chats?.[0]?.guid ?? null;
}

bb.onEvent((event) => {
  switch (event.kind) {
    case "new-message":
    case "updated-message": {
      const chatGuid = chatGuidOf(event.message);
      const mapped =
        event.kind === "new-message"
          ? directory.applyMessage(chatGuid, event.message)
          : directory.applyUpdatedMessage(chatGuid, event.message);
      if (!chatGuid || mapped === null) {
        broadcast({ kind: "chats-changed" });
        return;
      }
      broadcast({ kind: event.kind, chatGuid, message: mapped });
      return;
    }
    case "chat-read-status-changed":
      directory.invalidate(true);
      return;
    case "typing":
      broadcast({ kind: "typing", chatGuid: event.chatGuid, display: event.display });
      return;
    case "group-changed":
      directory.invalidate();
      return;
  }
});

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

  // buildThread drops tapbacks/reactions, so a raw page can filter down to very
  // few real messages. Keep paging until we have a solid batch or truly run out,
  // otherwise the client stops paginating and old history looks unreachable.
  const sort: "ASC" | "DESC" = after ? "ASC" : "DESC";
  const TARGET = 40;
  const RAW_LIMIT = 100;
  const raw: BBMessage[] = [];
  let cursorBefore = before ? Number(before) : undefined;
  let cursorAfter = after ? Number(after) : undefined;

  for (let page = 0; page < 6; page++) {
    const result = await bb.chatMessages(chatGuid, {
      before: cursorBefore,
      after: cursorAfter,
      sort,
      limit: RAW_LIMIT,
    });
    if (!result.ok) {
      if (raw.length === 0) return c.json({ error: result.error }, 502);
      break;
    }
    if (result.value.length === 0) break;
    raw.push(...result.value);
    // Count non-tapback, non-retracted messages gathered so far.
    const real = raw.filter((m) => !m.associatedMessageGuid && !m.dateRetracted).length;
    if (real >= TARGET || result.value.length < RAW_LIMIT) break;
    // Advance the cursor past the oldest/newest date seen.
    const dates = result.value.map((m) => m.dateCreated ?? 0).filter((d) => d > 0);
    if (dates.length === 0) break;
    if (sort === "DESC") cursorBefore = Math.min(...dates);
    else cursorAfter = Math.max(...dates);
  }

  return c.json(buildThread(raw, chatGuid, contacts));
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
    // No photo → a transparent 1×1 PNG, so the client renders the initials /
    // gradient underneath instead of a broken-image glyph.
    const px = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    return new Response(new Uint8Array(px), { headers: { ...headers, "Content-Type": "image/png" } });
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
  const caption = (form.get("caption") as string | null)?.trim() || undefined;
  const isAudio = form.get("isAudioMessage") === "true";
  const name = file.name || "attachment";
  const result = isAudio
    ? await bb.sendAudio(chatGuid, name, bytes)
    : await bb.sendAttachmentWithCaption(chatGuid, name, bytes, caption);
  if (!result.ok) return c.json({ error: result.error }, 502);
  const mapped = mapMessage(result.value, chatGuid, contacts);
  directory.applyKnownMessage(chatGuid, mapped);
  return c.json(mapped);
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

// ----------------------------------------------------------- group / delete

app.get("/api/chats/:guid/info", async (c) => {
  const chat = await bb.getChat(c.req.param("guid"));
  if (!chat.ok) return c.json({ error: chat.error }, 502);
  await contacts.refresh();
  const participants = (chat.value.participants ?? []).map((p) => ({
    address: p.address,
    name: contacts.lookup(p.address),
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
  const result = await bb.deleteChat(c.req.param("guid"));
  if (!result.ok) return c.json({ error: result.error }, 502);
  directory.invalidate();
  broadcast({ kind: "chats-changed" });
  return c.json({ ok: true });
});

// -------------------------------------------------------- scheduled messages

app.get("/api/scheduled", async (c) => {
  const result = await directory.summaries();
  const names = new Map(result.ok ? result.chats.map((ch) => [ch.guid, ch.displayName]) : []);
  return c.json(
    db.listScheduled().map((s) => ({
      id: s.id,
      chatGuid: s.chatGuid,
      chatName: names.get(s.chatGuid) ?? s.chatGuid,
      text: s.text,
      sendAt: s.sendAt,
    })),
  );
});

app.post("/api/scheduled", async (c) => {
  const body = (await c.req.json()) as { chatGuid: string; text: string; sendAt: number };
  if (!body.chatGuid || !body.text?.trim() || !body.sendAt) {
    return c.json({ error: "chatGuid, text, sendAt required" }, 400);
  }
  const id = `sch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.addScheduled(id, body.chatGuid, body.text.trim(), body.sendAt);
  return c.json({ id });
});

app.delete("/api/scheduled/:id", async (c) => {
  db.removeScheduled(c.req.param("id"));
  return c.json({ ok: true });
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
