import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { Glob } from "bun";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type { ConvexClient } from "convex/browser";
import { convexTest } from "convex-test";

import { FakeBlueBubbles } from "../../apps/imsg/server/bluebubbles-fake";
import { startBridge } from "../../apps/imsg/server/bridge";
import { ConvexIngest, withAccount, type BridgeAccount } from "../../apps/imsg/server/bridge/convex-ingest";
import { ChatCommands } from "../../apps/imsg/server/commands";
import type { Config } from "../../apps/imsg/server/config";
import { ContactBook } from "../../apps/imsg/server/contacts";
import { OverlayDb } from "../../apps/imsg/server/db";
import { api } from "../_generated/api";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";

import { IMESSAGE_ACCOUNT } from "./conversationIdentity";

/**
 * The Mini's iMessage bridge against the real Convex functions, joined over the real /comma/ingest routes in
 * http.ts. BlueBubbles, chat.db and the network hop are fakes; the bridge, its ConvexIngest client, the ROUTES
 * table and every ingest mutation are production code. A route the bridge posts that Convex does not register,
 * or a body a mutation's validator rejects, fails here. Runs under `bun test` (the bridge needs bun:sqlite).
 */

const convexDir = join(import.meta.dir, "..");
const modules = Object.fromEntries([...new Glob("**/*.{ts,js}").scanSync(convexDir)]
  .filter((path) => !/\.(test|vitest|d)\.ts$/.test(path) && !path.includes("node_modules"))
  .map((path) => [`../../${relative(convexDir, join(convexDir, path))}`, () => import(join(convexDir, path))]));

const SECRET = "bridge-contract-secret";
const SITE = "https://bridge-contract.convex.site";
const DM = "iMessage;-;+15550001111";
const GROUP = "iMessage;+;chat-launch";
const config: Config = {
  bbUrl: "fixture://bb", bbPassword: "fixture", hostname: "127.0.0.1", port: 0, dbPath: ":memory:",
  convexSiteUrl: SITE, commaBridgeSecret: SECRET, appleContactsIngestSecret: null,
  convexCloudUrl: "https://bridge-contract.convex.cloud", identityKey: null,
};

const previous = process.env.COMMA_BRIDGE_SECRET;
const realFetch = globalThis.fetch;
const dirs: string[] = [];
beforeEach(() => { process.env.COMMA_BRIDGE_SECRET = SECRET; });
afterEach(() => {
  globalThis.fetch = realFetch;
  if (previous === undefined) delete process.env.COMMA_BRIDGE_SECRET;
  else process.env.COMMA_BRIDGE_SECRET = previous;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Backend = ReturnType<typeof convexTest>;

/** Routes the bridge's fetches: ingest routes to Convex's HTTP router, upload URLs to Convex file storage. */
function connect(t: Backend) {
  const paths: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(SITE)) {
      paths.push(url.slice(SITE.length));
      return await t.fetch(url.slice(SITE.length), init);
    }
    const bytes = new Blob([init?.body as BodyInit], { type: new Headers(init?.headers).get("Content-Type") ?? undefined });
    const storageId = await t.run(async (ctx) => await ctx.storage.store(bytes));
    return Response.json({ storageId });
  }) as typeof fetch;
  return paths;
}

/** chat.db as the bridge reads it: one unread inbound message in the DM. */
function chatDb() {
  const dir = mkdtempSync(join(tmpdir(), "comma-bridge-contract-"));
  dirs.push(dir);
  const path = join(dir, "chat.db");
  const db = new Database(path);
  db.exec(`CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, date INTEGER, is_from_me INTEGER, is_read INTEGER,
      associated_message_type INTEGER, item_type INTEGER, group_action_type INTEGER, date_retracted INTEGER);
    INSERT INTO chat VALUES (1, '${DM}');
    INSERT INTO message VALUES (1, 'm1', 812000000000000000, 0, 0, 0, 0, 0, 0);
    INSERT INTO chat_message_join VALUES (1, 1);`);
  db.close();
  return path;
}

/** The outbox's pending-rows subscription, which the test fires the way Convex would after an enqueue. */
function outboxSubscription() {
  const listeners: Array<(rows: unknown[]) => void> = [];
  const client = {
    onUpdate: (_query: unknown, _args: unknown, listener: (rows: unknown[]) => void) => {
      listeners.push(listener);
      return () => {};
    },
    close: async () => {},
  } as unknown as ConvexClient;
  return { client, wake: () => { for (const listener of listeners) listener([{}]); } };
}

function world() {
  const now = Date.now();
  return new FakeBlueBubbles({
    chats: [
      { guid: DM, participants: [{ address: "+15550001111" }], messages: [
        { guid: "m1", originalROWID: 1, text: "Are we on for Friday?", dateCreated: now - 60_000, isFromMe: false,
          handle: { address: "+15550001111" }, attachments: [{ guid: "a1", mimeType: "image/png", transferName: "plan.png", totalBytes: 4, transferState: 5 }] },
      ] },
      { guid: GROUP, displayName: "Launch Crew", participants: [{ address: "+15550002222" }, { address: "+15550003333" }], messages: [
        { guid: "g1", originalROWID: 2, text: "Shipping today", dateCreated: now - 30_000, isFromMe: false, handle: { address: "+15550002222" } },
      ] },
    ],
    scheduledMessages: [{ id: 7, type: "send-message", payload: { chatGuid: DM, message: "See you then", method: "apple-script" },
      scheduledFor: now + 3_600_000, schedule: { type: "once" }, status: "pending", error: null, sentAt: null, created: now }],
    attachments: { a1: { meta: { guid: "a1", mimeType: "image/png", transferName: "plan.png", totalBytes: 4 }, bytes: new Uint8Array([137, 80, 78, 71]) } },
  });
}

test("startup, conversations, messages, attachments, unread, scheduled, sync and a send round-trip through the real ingest routes", async () => {
  const t = convexTest(schema, modules);
  const paths = connect(t);
  const errors = spyOn(console, "error").mockImplementation(() => {});
  const bb = world();
  const outbox = outboxSubscription();
  const bridge = startBridge({ config, bb, db: new OverlayDb(":memory:"), commands: new ChatCommands(bb, new ContactBook(bb)),
    chatDbPath: chatDb(), avatarDirectory: join(tmpdir(), "comma-bridge-contract-no-avatars"), outboxClient: outbox.client });
  try {
    await bridge.flush();
    // The scheduled mirror's first post can land before backfill writes the conversation; its next refresh links it.
    bridge.scheduledChanged();
    await bridge.flush();
    expect(errors.mock.calls).toEqual([]);
    expect(bridge.health().pending).toBe(0);
    for (const kind of ["account", "conversations", "messages", "attachments", "unread", "scheduled", "sync", "ephemeral", "claim"]) {
      expect(paths).toContain(`/comma/ingest/${kind}`);
    }

    const stored = await t.run(async (ctx) => ({
      accounts: await ctx.db.query("comma_accounts").collect(),
      conversations: await ctx.db.query("comma_conversations").collect(),
      messages: await ctx.db.query("comma_messages").collect(),
      attachments: await ctx.db.query("comma_attachments").collect(),
      scheduled: await ctx.db.query("comma_scheduled").collect(),
      sync: await ctx.db.query("comma_sync_state").collect(),
      status: await ctx.db.query("comma_bridge_state").collect(),
    }));
    expect(stored.accounts).toHaveLength(1);
    const accountId = stored.accounts[0]!._id;
    expect(stored.accounts[0]).toMatchObject({ platform: "imessage" });
    const dm = stored.conversations.find((row) => row.primaryChatGuid === DM)!;
    expect(dm).toMatchObject({ accountId, isGroup: false, unread: { count: 1 } });
    expect(stored.conversations.find((row) => row.primaryChatGuid === GROUP)).toMatchObject({ accountId, isGroup: true, displayName: "Launch Crew" });
    expect(stored.messages.find((row) => row.guid === "m1")).toMatchObject({ accountId, conversationId: dm._id, text: "Are we on for Friday?",
      imessage: { chatGuid: DM } });
    expect(stored.attachments.find((row) => row.guid === "a1")).toMatchObject({ conversationId: dm._id, messageGuid: "m1" });
    expect(stored.scheduled).toEqual([expect.objectContaining({ bbId: 7, conversationId: dm._id, text: "See you then" })]);
    expect(stored.sync.map((row) => row.accountId)).not.toContain(undefined);
    expect(stored.status.some((row) => "key" in row && row.key.startsWith("imessage:"))).toBe(true);

    const milad = t.withIdentity({ email: ALLOWED_EMAIL });
    const page = await milad.query(api.comma.queries.listConversations, { paginationOpts: { numItems: 10, cursor: null } });
    expect(page.page.map((row: { displayName: string }) => row.displayName)).toContain("Launch Crew");

    const commandId = await milad.mutation(api.comma.outbox.enqueue, { clientKey: "contract-send", conversationId: dm._id, payload: { kind: "send", text: "Yes, Friday" } });
    outbox.wake();
    await bridge.flush();
    expect(errors.mock.calls).toEqual([]);
    expect(paths).toContain("/comma/ingest/complete");
    expect(await milad.query(api.comma.outbox.getCommand, { commandId })).toMatchObject({ status: "sent" });
    const sent = await t.run(async (ctx) => await ctx.db.query("comma_messages").collect());
    expect(sent.find((row) => row.clientKey === "contract-send")).toMatchObject({ conversationId: dm._id, isFromMe: true, text: "Yes, Friday" });
  } finally {
    bridge.stop();
    errors.mockRestore();
  }
});

test("flat legacy message rows, and a claim renewed and completed, pass through the real client and routes", async () => {
  const t = convexTest(schema, modules);
  connect(t);
  const base = new ConvexIngest(config);
  const accountId: BridgeAccount["accountId"] = await base.post("account", IMESSAGE_ACCOUNT);
  const ingest = withAccount(base, { platform: "imessage", accountId });
  const ids = await ingest.post("conversations", { conversations: [{ conversationKey: "dm:+15550004444", displayName: "+15550004444", isGroup: false,
    participants: [{ address: "+15550004444", name: null }], lastMessageAt: 5, isSpam: false, hasGroupPhoto: false, chats: [{ chatGuid: "iMessage;-;+15550004444", lastMessageAt: 5 }] }] });
  const conversationId = ids["iMessage;-;+15550004444"]!;
  // The flat shape bridges posted before accounts; Convex still accepts it and stores the side object.
  const flat = { guid: "legacy-1", conversationId, chatGuid: "iMessage;-;+15550004444", text: "flat row", dateCreated: 5, isFromMe: false,
    sender: { address: "+15550004444", name: null }, service: "iMessage", error: 0, edited: false, retracted: false, isTapback: false,
    reactions: [], isGroupEvent: false, mentions: [], attachmentGuids: [], sourceVersion: 1 };
  expect(await ingest.post("messages", { messages: [flat as never] })).toEqual({ written: 1, skipped: 0 });
  expect(await t.run(async (ctx) => await ctx.db.query("comma_messages").first())).toMatchObject({ guid: "legacy-1", imessage: { chatGuid: "iMessage;-;+15550004444" } });

  const milad = t.withIdentity({ email: ALLOWED_EMAIL });
  await milad.mutation(api.comma.outbox.enqueue, { clientKey: "contract-lease", conversationId, payload: { kind: "send", text: "lease" } });
  const [row] = await ingest.post("claim", { now: Date.now(), leaseMs: 30_000, limit: 1, lane: "imessage" });
  expect(row).toMatchObject({ clientKey: "contract-lease", payload: { kind: "send", text: "lease" } });
  expect(await ingest.post("renew", { clientKey: row!.clientKey, claimToken: row!.claimToken!, now: Date.now(), leaseMs: 30_000 })).toBe(true);
  expect(await ingest.post("complete", { clientKey: row!.clientKey, claimToken: row!.claimToken!, status: "failed", error: "contract" })).toBe(true);
  expect(await ingest.post("claim", { now: Date.now(), leaseMs: 30_000, limit: 1, lane: "imessage" })).toEqual([]);
});
