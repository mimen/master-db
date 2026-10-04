import { afterEach, beforeEach, expect, test } from "bun:test";
import { createApp } from "../../server/app";
import type { Config } from "../../server/config";
import { OverlayDb } from "../../server/db";
import type { ChatSummary, Message } from "../../shared/types";
import type { CommaOutboxPayload } from "../../../../convex/schema/comma/validators";
import { registerConvexFixture } from "./convex";
import { FixtureBlueBubbles } from "./fake-bluebubbles";
import { CHAT_GUIDS, FIXTURE_NOW, FixtureIdentity, fixtureSeed } from "./world";

const config: Config = {
  bbUrl: "fixture://bluebubbles", bbPassword: "fixture", hostname: "127.0.0.1", port: 0,
  dbPath: ":memory:", convexSiteUrl: null, appleContactsIngestSecret: null,
  convexCloudUrl: null, identityKey: null, commaBridgeSecret: null,
  whisper: { binaryPath: null, modelPath: null, workDir: "/tmp/imsg-fixture-test" },
  ai: { gatewayUrl: "http://127.0.0.1:9", gatewayKey: "", fastModel: "fixture", vaultPath: "/tmp" },
};
let fixture: Awaited<ReturnType<typeof createApp>>;
let bb: FixtureBlueBubbles;
let db: OverlayDb;
let reset: () => void;
beforeEach(async () => {
  bb = new FixtureBlueBubbles(fixtureSeed());
  db = new OverlayDb(":memory:");
  const identity = new FixtureIdentity();
  fixture = await createApp({
    config, bb, db, now: () => FIXTURE_NOW, names: identity, identity, backgroundServices: false,
    configureFixtureRoutes: (app, controls) => { reset = registerConvexFixture(app, controls, bb, db, identity); },
  });
});
afterEach(() => fixture.dispose());

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await fixture.app.request("/__fixture/convex", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, args }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
const query = <T>(name: string, args?: Record<string, unknown>) => call<T>(`comma/queries:${name}`, args);
const conversation = (guid = CHAT_GUIDS.needs as string) => query<{ _id: string; primaryChatGuid: string; displayName: string; flags: ChatSummary["flags"] }>("resolveChat", { chatGuid: guid });
const messages = (guid = CHAT_GUIDS.needs as string) => query<{ page: Array<Message & { attachments: unknown[]; clientKey?: string }> }>("listMessages", { conversationId: guid, paginationOpts: { numItems: 100, cursor: null } });
const command = (payload: CommaOutboxPayload, guid = CHAT_GUIDS.needs as string, clientKey: string = crypto.randomUUID()) => call<string>("comma/outbox:enqueue", { clientKey, conversationId: guid, payload });

test("Convex pagination and resolution mirror the REST directory", async () => {
  const rest = await (await fixture.app.request("/api/chats?state=any")).json() as ChatSummary[];
  const first = await query<{ page: Array<{ _id: string; primaryChatGuid: string }>; isDone: boolean; continueCursor: string }>("listConversations", { paginationOpts: { numItems: 2, cursor: null } });
  expect(first.page.map((row) => row.primaryChatGuid)).toEqual(rest.slice(0, 2).map((row) => row.guid));
  expect(first.isDone).toBe(false);
  const remainder = await query<typeof first>("listConversations", { paginationOpts: { numItems: 100, cursor: first.continueCursor } });
  expect(remainder.page.length).toBe(rest.length - 2);
  expect(remainder.isDone).toBe(true);
  expect((await conversation())._id).toBe(CHAT_GUIDS.needs);
  expect(await query("resolveChat", { chatGuid: "missing" })).toBeNull();
  const page = await messages();
  expect(page.page.map((row) => row.guid)).toEqual(["needs-2", "needs-1"]);
  expect(page.page[0]).toMatchObject({ conversationId: CHAT_GUIDS.needs, sourceVersion: 1, mentions: [], isTapback: false });
});

test("sends share REST history, preserve the client key, clear drafts, and deduplicate", async () => {
  await call("comma/drafts:setDraft", { conversationId: CHAT_GUIDS.needs, text: "draft" });
  expect(await query("getDraft", { conversationId: CHAT_GUIDS.needs })).toMatchObject({ text: "draft" });
  const clientKey = "fixture-send-key";
  const receipt = await command({ kind: "send", text: "sent through Convex", replyToGuid: "needs-2" }, CHAT_GUIDS.needs, clientKey);
  expect(await command({ kind: "send", text: "sent through Convex" }, CHAT_GUIDS.needs, clientKey)).toBe(receipt);
  expect(await query("getDraft", { conversationId: CHAT_GUIDS.needs })).toBeNull();
  const page = await messages();
  expect(page.page[0]).toMatchObject({ text: "sent through Convex", clientKey, replyToGuid: "needs-2", replyToPreview: "Can you send the final arrival time?" });
  expect(page.page.filter((row) => row.clientKey === clientKey)).toHaveLength(1);
  const rest = await (await fixture.app.request(`/api/chats/${encodeURIComponent(CHAT_GUIDS.needs)}/messages`)).json() as Message[];
  expect(rest.at(-1)?.guid).toBe(page.page[0].guid);
  expect(await call<unknown>("comma/outbox:outboxStatusFor", { clientKeys: [clientKey] })).toEqual([{ clientKey, status: "sent" }]);
});

test("read, unread, settle, unsettle, pin, and mute update the shared overlay", async () => {
  await command({ kind: "markUnread" });
  expect((await conversation()).flags.unread).toBe(true);
  await command({ kind: "markRead" });
  expect((await conversation()).flags.unread).toBe(false);
  await command({ kind: "settle", messageGuid: "needs-2" });
  expect((await conversation()).flags.unresponded).toBe(false);
  await command({ kind: "unsettle" });
  expect((await conversation()).flags.unresponded).toBe(true);
  await command({ kind: "pin", value: true });
  await command({ kind: "mute", value: true });
  expect((await conversation()).flags.pinned).toBe(true);
  expect(db.getAll().get(CHAT_GUIDS.needs)?.mutedUnresponded).toBe(1);
});

test("concurrent enqueue retries execute a send once and failed execution can retry", async () => {
  const payload = { kind: "send", text: "concurrent send" } as const;
  bb.setFault("sendText", "offline");
  await expect(command(payload, CHAT_GUIDS.needs, "concurrent-key")).rejects.toThrow("offline");
  bb.setFault(null);
  bb.setSendTiming({ delayMs: 30, echo: false });
  const receipts = await Promise.all([
    command(payload, CHAT_GUIDS.needs, "concurrent-key"),
    command(payload, CHAT_GUIDS.needs, "concurrent-key"),
  ]);
  expect(receipts[0]).toBe(receipts[1]);
  expect((await messages()).page.filter((row) => row.clientKey === "concurrent-key")).toHaveLength(1);
});

test("reactions, edits, unsends, deletes, and rename persist in both read paths", async () => {
  await command({ kind: "react", messageGuid: "needs-2", reaction: "like", remove: false });
  expect((await messages()).page.find((row) => row.guid === "needs-2")?.reactions).toMatchObject([{ type: "like", isFromMe: true }]);
  await command({ kind: "react", messageGuid: "needs-2", reaction: "like", remove: true });
  expect((await messages()).page.find((row) => row.guid === "needs-2")?.reactions).toEqual([]);
  await command({ kind: "edit", messageGuid: "needs-1", text: "edited fixture" });
  expect((await messages()).page.find((row) => row.guid === "needs-1")).toMatchObject({ text: "edited fixture", edited: true });
  await command({ kind: "unsend", messageGuid: "needs-1" });
  expect((await messages()).page.map((row) => row.guid)).toEqual(["needs-2"]);
  await command({ kind: "delete", messageGuid: "needs-2" });
  expect((await messages()).page).toEqual([]);
  await command({ kind: "rename", name: "Renamed Crew" }, CHAT_GUIDS.unreadGroup);
  expect((await conversation(CHAT_GUIDS.unreadGroup)).displayName).toBe("Renamed Crew");
});

test("scheduled commands and REST changes appear in the Convex scheduled query", async () => {
  const sendAt = Date.now() + 86_400_000;
  await command({ kind: "schedule", text: "scheduled Convex", sendAt });
  const rows = await query<Array<{ bbId: number; text: string }>>("listScheduled");
  const scheduled = rows.find((row) => row.text === "scheduled Convex")!;
  expect(scheduled).toBeDefined();
  await command({ kind: "editScheduled", bbId: scheduled.bbId, text: "edited schedule", sendAt: sendAt + 1 });
  expect(await query("listScheduled")).toContainEqual(expect.objectContaining({ bbId: scheduled.bbId, text: "edited schedule" }));
  await command({ kind: "cancelScheduled", bbId: scheduled.bbId });
  expect((await query<typeof rows>("listScheduled")).some((row) => row.bbId === scheduled.bbId)).toBe(false);
});

test("send faults fail the Convex call and echo timing preserves a shared identity", async () => {
  bb.setFault("sendText", "offline");
  await expect(command({ kind: "send", text: "failed" })).rejects.toThrow("offline");
  expect((await messages()).page.some((row) => row.text === "failed")).toBe(false);
  bb.setFault(null);
  bb.setSendTiming({ delayMs: 30, echo: true });
  let resolveEcho!: () => void;
  const echo = new Promise<void>((resolve) => { resolveEcho = resolve; });
  const unsubscribe = bb.onEvent((event) => { if (event.kind === "new-message") resolveEcho(); });
  let done = false;
  const pending = command({ kind: "send", text: "early echo" }, CHAT_GUIDS.needs, "early-key").then(() => { done = true; });
  await echo;
  expect(done).toBe(false);
  expect((await messages()).page[0]).toMatchObject({ text: "early echo", clientKey: "early-key" });
  await pending;
  unsubscribe();
});

test("unknown function names return a diagnostic 400 and reset clears fixture drafts", async () => {
  const response = await fixture.app.request("/__fixture/convex", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "comma/queries:missing", args: {} }) });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Unknown fixture Convex function: comma/queries:missing" });
  await call("comma/drafts:setDraft", { conversationId: CHAT_GUIDS.needs, text: "draft" });
  reset();
  expect(await query("getDraft", { conversationId: CHAT_GUIDS.needs })).toBeNull();
});

test("link preview actions return deterministic public previews and null for blocked URLs", async () => {
  const name = "comma/linkPreview:fetchLinkPreview";
  const url = "https://example.com/article";
  const preview = await call(name, { url });
  expect(preview).toEqual({
    url, title: "Fixture link preview", description: "A deterministic preview for fixture messages.",
    image: null, siteName: "example.com",
  });
  expect(await call(name, { url })).toEqual(preview);
  for (const blocked of ["http://localhost/", "http://10.0.0.1/", "https://device.ts.net/", "not a URL"]) {
    expect(await call(name, { url: blocked })).toBeNull();
  }
});
