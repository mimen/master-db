import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../server/app";
import type { Config } from "../../server/config";
import { OverlayDb } from "../../server/db";
import { FixtureAi } from "./ai";
import { FixtureBlueBubbles, type FaultableMethod } from "./fake-bluebubbles";
import { CHAT_GUIDS, FIXTURE_NOW, FixtureIdentity, fixtureSeed } from "./world";

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const runtimeDirectory = join(fixtureDirectory, ".runtime");
const dbPath = join(runtimeDirectory, "overlay.db");
const port = Number(Bun.env.IMSG_FIXTURE_PORT ?? 8399);

mkdirSync(runtimeDirectory, { recursive: true });
for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });

const originalDateNow = Date.now;
Date.now = () => FIXTURE_NOW;

const config: Config = {
  bbUrl: "fixture://bluebubbles",
  bbPassword: "fixture-only",
  hostname: "127.0.0.1",
  port,
  dbPath,
  convexSiteUrl: null,
  appleContactsIngestSecret: null,
  convexCloudUrl: null,
  identityKey: null,
  whisper: {
    binaryPath: null,
    modelPath: null,
    workDir: join(runtimeDirectory, "whisper"),
  },
  ai: {
    gatewayUrl: "http://127.0.0.1:9",
    gatewayKey: "",
    fastModel: "fixture",
    vaultPath: runtimeDirectory,
    creatorRef: "imsg-visual-fixture",
    ccsBin: "fixture-disabled",
    shadowSeat: "fixture-disabled",
    shadowCwd: runtimeDirectory,
  },
};

const bb = new FixtureBlueBubbles(fixtureSeed());
const db = new OverlayDb(dbPath);
const identity = new FixtureIdentity();

function seedOverlay(): void {
  db.setPinned(CHAT_GUIDS.needs, true);
  db.setMarkedUnread(CHAT_GUIDS.unreadGroup, true);
  db.setArchived(CHAT_GUIDS.archived, true);
  const seed = fixtureSeed();
  const contactNames = new Map(
    seed.contacts.flatMap((contact) => contact.phoneNumbers.map((phone) => [phone.address, contact.displayName] as const)),
  );
  for (const chat of seed.chats) {
    const last = chat.messages.at(-1);
    if (!last || last.isFromMe) continue;
    const address = chat.participants[0]?.address;
    const firstName = address ? contactNames.get(address)?.split(" ")[0] : undefined;
    db.setSuggestionCache(
      chat.guid,
      last.guid,
      JSON.stringify([`Yes${firstName ? `, ${firstName}` : ""} — I’ll send the final timing shortly.`]),
    );
  }
}

function resetOverlay(): void {
  const sqlite = new Database(dbPath);
  const tables = [
    "chat_state",
    "attachment_transcript",
    "shadow_message",
    "ai_meta",
    "suggestion_cache",
    "smart_closer_cache",
    "shadow_brief_cache",
    "triage_clear_event",
    "triage_open_item",
  ];
  sqlite.transaction(() => {
    for (const table of tables) sqlite.exec(`DELETE FROM ${table}`);
  })();
  sqlite.close();
  seedOverlay();
}

seedOverlay();

const faultableMethods = new Set<FaultableMethod>([
  "connect",
  "queryChats",
  "chatMessages",
  "queryMessages",
  "messageWithReactions",
  "sendText",
  "sendAttachment",
  "react",
  "markRead",
  "setTyping",
  "unsend",
  "edit",
  "createChat",
  "sendAudio",
  "sendAttachmentWithCaption",
  "renameGroup",
  "addParticipant",
  "removeParticipant",
  "leaveGroup",
  "deleteChat",
  "deleteMessage",
  "contacts",
  "getChat",
  "attachmentMeta",
  "downloadAttachment",
  "listScheduledMessages",
  "createScheduledMessage",
  "updateScheduledMessage",
  "deleteScheduledMessage",
  "createFaceTimeLink",
]);

const { app, dispose } = await createApp({
  config,
  bb,
  db,
  now: () => FIXTURE_NOW,
  names: identity,
  identity,
  ai: new FixtureAi(db),
  shadowStatus: { available: true, detail: "deterministic fixture" },
  backgroundServices: false,
  staticRoot: join(fixtureDirectory, "dist"),
  configureFixtureRoutes: (fixtureApp, controls) => {
    fixtureApp.post("/__fixture/reset", (c) => {
      bb.reset(fixtureSeed());
      resetOverlay();
      controls.directory.invalidate(true);
      controls.broadcast({ kind: "resync" });
      return c.json({ ok: true, now: FIXTURE_NOW });
    });

    fixtureApp.post("/__fixture/receive", async (c) => {
      const body = (await c.req.json()) as { chatGuid?: string; text?: string; handle?: string };
      if (!body.chatGuid || !body.text?.trim()) {
        return c.json({ error: "chatGuid and text are required" }, 400);
      }
      const message = bb.receiveMessage(body.chatGuid, body.text.trim(), body.handle);
      return c.json({ ok: true, message });
    });

    fixtureApp.post("/__fixture/fault", async (c) => {
      const body = (await c.req.json()) as { method?: string | null; error?: string };
      if (body.method === null || body.method === undefined) {
        bb.setFault(null);
        return c.json({ ok: true, fault: null });
      }
      if (!faultableMethods.has(body.method as FaultableMethod)) {
        return c.json({ error: "unknown BlueBubbles method" }, 400);
      }
      bb.setFault(body.method as FaultableMethod, body.error);
      return c.json({ ok: true, fault: body.method });
    });
  },
});

const server = Bun.serve({
  hostname: config.hostname,
  port: config.port,
  idleTimeout: 120,
  fetch: app.fetch,
});

console.log(`imsg visual fixture on http://${server.hostname}:${server.port}`);

function shutdown(): void {
  dispose();
  server.stop(true);
  Date.now = originalDateNow;
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
