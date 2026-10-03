import { Database } from "bun:sqlite";
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeBlueBubbles } from "../bluebubbles-fake";
import { loadConfig } from "../config";
import type { BBMessage } from "../bb-types";
import { runBackfill } from "./backfill";
import type { AttachmentRow, MessageRow } from "./convex-ingest";

const dirs: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "comma-backfill-"));
  dirs.push(dir);
  const chatDbPath = join(dir, "chat.db");
  const db = new Database(chatDbPath);
  db.run("CREATE TABLE message (guid TEXT)");
  const raw: BBMessage[] = Array.from({ length: 205 }, (_, i) => ({
    guid: `m${i + 1}`, originalROWID: i + 1, text: "hello", dateCreated: i + 1,
    attachments: [{ guid: `a${i + 1}`, transferState: 5 }],
  }));
  for (const message of raw) db.run("INSERT INTO message (ROWID, guid) VALUES (?, ?)", [message.originalROWID!, message.guid]);
  db.run("INSERT INTO message (ROWID, guid) VALUES (1005, 'orphan')");
  db.close();
  const bb = new FakeBlueBubbles({ chats: [{ guid: "iMessage;-;+15550001111",
    participants: [{ address: "+15550001111" }], messages: raw }] });
  const query = bb.queryMessages.bind(bb);
  spyOn(bb, "queryMessages").mockImplementation(async (options) => {
    const result = await query({ ...options, limit: 9999, offset: 0 });
    if (!result.ok) return result;
    const range = options.rowidRange;
    return { ok: true, value: result.value.filter((message) => !range ||
      (message.originalROWID! > range.after && message.originalROWID! <= range.through)).slice(options.offset, options.offset + options.limit) };
  });
  spyOn(bb, "messageWithReactions").mockResolvedValue({ ok: true,
    value: [{ guid: "orphan", originalROWID: 1005 }] });
  const calls: { kind: string; body: { messages?: MessageRow[]; attachments?: AttachmentRow[]; cursor?: string } }[] = [];
  let failAttachments = false;
  const id = "test-conversation" as MessageRow["conversationId"];
  const server = Bun.serve({ port: 0, fetch: async (request) => {
    const kind = new URL(request.url).pathname.split("/").at(-1)!;
    const body = await request.json() as (typeof calls)[number]["body"];
    calls.push({ kind, body });
    if (kind === "attachments" && failAttachments) return new Response("failed", { status: 400 });
    const result = kind === "conversations" ? { "iMessage;-;+15550001111": id } : kind === "sync" ? null : { written: 1, skipped: 0 };
    return Response.json({ ok: true, result });
  } });
  servers.push(server);
  const config = { ...loadConfigForTest(), convexSiteUrl: server.url.toString().replace(/\/$/, ""), commaBridgeSecret: "test" };
  return { bb, calls, options: { config, bb, chatDbPath, checkpointPath: join(dir, "cursor.json") },
    fail: (value: boolean) => { failAttachments = value; } };
}

test("backfill batches raw rows, counts orphans and resumes without replay", async () => {
  const { options, calls, bb } = await fixture();
  const result = await runBackfill(options);
  expect(result).toMatchObject({ messages: 205, attachments: 205, conversations: 1,
    orphans: 1, cursor: 1005, chatDbMessages: 206 });
  expect(calls.filter((call) => call.kind === "messages").map((call) => call.body.messages?.length)).toEqual([200, 5]);
  expect(calls.filter((call) => call.kind === "attachments").map((call) => call.body.attachments?.length)).toEqual([200, 5]);
  expect(calls.at(-1)?.body.cursor).toBe("1005");
  const before = bb.calls.queryMessages;
  calls.length = 0;
  expect(await runBackfill(options)).toMatchObject({ messages: 205, attachments: 205, orphans: 1 });
  expect(bb.calls.queryMessages).toBe(before);
  expect(calls.some((call) => call.kind === "messages")).toBe(false);
});

test("attachment failure cannot advance the cursor", async () => {
  const { options, fail, calls } = await fixture();
  fail(true);
  await expect(runBackfill(options)).rejects.toThrow("HTTP 400");
  expect(await Bun.file(options.checkpointPath).exists()).toBe(false);
  expect(calls.some((call) => call.kind === "sync")).toBe(false);
  fail(false);
  expect(await runBackfill(options)).toMatchObject({ messages: 205, attachments: 205, orphans: 1 });
});

test("missing chat aliases are fetched and upserted before messages", async () => {
  const { options, bb, calls } = await fixture();
  spyOn(bb, "queryChats").mockResolvedValue({ ok: true, value: [] });
  expect(await runBackfill(options)).toMatchObject({ messages: 205, conversations: 1 });
  expect(calls[0].kind).toBe("conversations");
  expect(calls[1].kind).toBe("messages");
});

test("wrong-target checkpoint is rejected without writes", async () => {
  const { options, calls } = await fixture();
  await Bun.write(options.checkpointPath, JSON.stringify({ siteUrl: "other", bbUrl: options.config.bbUrl, cursor: 1000 }));
  await expect(runBackfill(options)).rejects.toThrow("wrong-target");
  expect(calls).toHaveLength(0);
});

test("unreadable chat.db falls back to bounded BlueBubbles queries", async () => {
  const { options, calls } = await fixture();
  options.chatDbPath = "/nonexistent/comma-chat.db";
  expect(await runBackfill(options)).toMatchObject({ messages: 205, cursor: 205, chatDbMessages: null, orphans: 0 });
  expect(calls.at(-1)?.body.cursor).toBe("205");
});

test("unset bridge secret leaves both sources untouched", async () => {
  const { options, calls, bb } = await fixture();
  options.config.commaBridgeSecret = "";
  expect(await runBackfill(options)).toBeNull();
  expect(calls).toHaveLength(0);
  expect(bb.calls.queryChats).toBe(0);
});

function loadConfigForTest() {
  const password = Bun.env.BB_PASSWORD;
  Bun.env.BB_PASSWORD = "test";
  try { return loadConfig(); }
  finally { if (password === undefined) delete Bun.env.BB_PASSWORD; else Bun.env.BB_PASSWORD = password; }
}
