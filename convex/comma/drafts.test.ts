import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";

import { api, internal } from "../_generated/api";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
afterEach(() => vi.restoreAllMocks());

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const conversationId = await t.run((ctx) => ctx.db.insert("comma_conversations", {
    conversationKey: "dm:+15550001111",
    primaryChatGuid: "iMessage;-;+15550001111",
    chatGuids: ["iMessage;-;+15550001111"],
    displayName: "Alex",
    isGroup: false,
    participants: [],
    lastMessageAt: 1,
    isSpam: false,
    hasGroupPhoto: false,
    updatedAt: 1,
  }));
  return { t, as: t.withIdentity({ subject: `${userId}|session` }), conversationId };
}

test("upserts one draft and the last write gets the server timestamp", async () => {
  const { t, as, conversationId } = await setup();
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "first" });
  const first = await as.query(api.comma.queries.getDraft, { conversationId });
  expect(first).toMatchObject({ text: "first", updatedAt: 1000 });
  clock.mockReturnValue(2000);
  await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "second" });
  const second = await as.query(api.comma.queries.getDraft, { conversationId });
  expect(second).toMatchObject({ _id: first?._id, text: "second", updatedAt: 2000 });
  expect(await t.run((ctx) => ctx.db.query("comma_drafts").collect())).toHaveLength(1);
});

test("empty text and explicit clear delete the row, including repeated clears", async () => {
  const { as, conversationId } = await setup();
  for (const clear of [
    () => as.mutation(api.comma.drafts.setDraft, { conversationId, text: "" }),
    () => as.mutation(api.comma.drafts.clearDraft, { conversationId }),
  ]) {
    await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "draft" });
    await clear();
    await clear();
    expect(await as.query(api.comma.queries.getDraft, { conversationId })).toBeNull();
  }
});

test("draft reads and writes reject unauthenticated and disallowed users", async () => {
  const { t, conversationId } = await setup();
  const otherId = await t.run((ctx) => ctx.db.insert("users", { email: "other@example.com" }));
  for (const caller of [t, t.withIdentity({ subject: `${otherId}|session` })]) {
    await expect(caller.mutation(api.comma.drafts.setDraft, { conversationId, text: "no" })).rejects.toThrow("Unauthorized");
    await expect(caller.mutation(api.comma.drafts.clearDraft, { conversationId })).rejects.toThrow("Unauthorized");
    await expect(caller.query(api.comma.queries.getDraft, { conversationId })).rejects.toThrow("Unauthorized");
  }
});

test("only a new send clears its conversation draft, retries preserve the next draft", async () => {
  const { as, conversationId } = await setup();
  await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "draft" });
  await as.mutation(api.comma.outbox.enqueue, {
    clientKey: "pin", conversationId, payload: { kind: "pin", value: true },
  });
  expect(await as.query(api.comma.queries.getDraft, { conversationId })).toMatchObject({ text: "draft" });
  const args = { clientKey: "send", conversationId, payload: { kind: "send" as const, text: "draft" } };
  await as.mutation(api.comma.outbox.enqueue, args);
  expect(await as.query(api.comma.queries.getDraft, { conversationId })).toBeNull();
  await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "next" });
  await as.mutation(api.comma.outbox.enqueue, args);
  expect(await as.query(api.comma.queries.getDraft, { conversationId })).toMatchObject({ text: "next" });
});

async function stored(t: Awaited<ReturnType<typeof setup>>["t"], filename = "photo.png", mimeType = "image/png") {
  return await t.action(internal.comma.drafts.storeAttachment, { filename, mimeType, base64: btoa("png-bytes") });
}

test("storeAttachment stores the bytes and finalizes the upload the send path checks", async () => {
  const { t } = await setup();
  const { storageId, size } = await stored(t);
  expect(size).toBe(9);
  const upload = await t.run((ctx) => ctx.db.query("comma_uploads").withIndex("by_storageId", (q) => q.eq("storageId", storageId)).unique());
  expect(upload).toMatchObject({ filename: "photo.png", mimeType: "image/png", totalBytes: 9 });
  expect(await t.run(async (ctx) => await (await ctx.storage.get(storageId))?.text())).toBe("png-bytes");
  await expect(t.action(internal.comma.drafts.storeAttachment, { filename: "x", mimeType: "text/plain", base64: "" })).rejects.toThrow("empty");
});

test("prepareDraft resolves a conversation by phone in any format, chatGuid, or id", async () => {
  const { t, as } = await setup();
  const conversationId = await t.run((ctx) => ctx.db.insert("comma_conversations", {
    conversationKey: "dm:+14155552671", primaryChatGuid: "iMessage;-;+14155552671", chatGuids: ["iMessage;-;+14155552671"],
    displayName: "Kai", isGroup: false, participants: [], lastMessageAt: 1, isSpam: false, hasGroupPhoto: false, updatedAt: 1,
  }));
  await t.run((ctx) => ctx.db.insert("comma_chat_aliases", { chatGuid: "iMessage;-;+14155552671", conversationId, service: "iMessage" }));
  for (const to of [{ address: "(415) 555-2671" }, { address: "+1 415 555 2671" }, { chatGuid: "iMessage;-;+14155552671" }, { conversationId }]) {
    const result = await t.mutation(internal.comma.drafts.prepareDraft, { ...to, text: `hi ${JSON.stringify(to)}` });
    expect(result.conversationId).toBe(conversationId);
  }
  expect(await t.run((ctx) => ctx.db.query("comma_drafts").collect())).toHaveLength(1);
  await expect(t.mutation(internal.comma.drafts.prepareDraft, { address: "+15559999999", text: "x" })).rejects.toThrow("No conversation");
  await expect(t.mutation(internal.comma.drafts.prepareDraft, { address: "+14155552671", conversationId, text: "x" })).rejects.toThrow("exactly one");
  await expect(as.query(api.comma.queries.getDraft, { conversationId })).resolves.toMatchObject({ source: "agent" });
});

test("prepareDraft never overwrites the user's own text unless forced, and replaces an agent draft", async () => {
  const { t, as, conversationId } = await setup();
  await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "mine" });
  await expect(t.mutation(internal.comma.drafts.prepareDraft, { conversationId, text: "agent" })).rejects.toThrow("user wrote");
  expect(await as.query(api.comma.queries.getDraft, { conversationId })).toMatchObject({ text: "mine", source: "user" });

  const forced = await t.mutation(internal.comma.drafts.prepareDraft, { conversationId, text: "agent", note: "Asked about Friday", force: true });
  expect(forced.replaced).toBe(true);
  const { storageId } = await stored(t);
  await t.mutation(internal.comma.drafts.prepareDraft, { conversationId, text: "agent v2", attachments: [storageId] });
  const draft = await as.query(api.comma.queries.getDraft, { conversationId });
  expect(draft).toMatchObject({ text: "agent v2", source: "agent", attachments: [{ storageId, filename: "photo.png", mimeType: "image/png", size: 9 }] });
  expect(draft?.note).toBeUndefined();
  expect(draft?.attachments?.[0]?.url).toEqual(expect.any(String));
});

test("prepareDraft rejects attachments that skipped storeAttachment", async () => {
  const { t, conversationId } = await setup();
  const raw = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
  await expect(t.mutation(internal.comma.drafts.prepareDraft, { conversationId, text: "x", attachments: [raw] })).rejects.toThrow("storeAttachment");
  await expect(t.mutation(internal.comma.drafts.prepareDraft, { conversationId, text: " " })).rejects.toThrow("text or an attachment");
});

test("editing an agent draft makes it the user's and keeps its attachments; an echo is not an edit", async () => {
  const { t, as, conversationId } = await setup();
  const { storageId } = await stored(t);
  await t.mutation(internal.comma.drafts.prepareDraft, { conversationId, text: "agent", attachments: [storageId] });
  await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "agent" });
  expect(await as.query(api.comma.queries.getDraft, { conversationId })).toMatchObject({ source: "agent" });
  await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "edited" });
  expect(await as.query(api.comma.queries.getDraft, { conversationId })).toMatchObject({ source: "user", text: "edited", attachments: [{ storageId }] });
  // Emptying the text keeps a draft that still has attachments; removing the last one deletes it.
  await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "" });
  expect(await as.query(api.comma.queries.getDraft, { conversationId })).toMatchObject({ text: "", attachments: [{ storageId }] });
  await as.mutation(api.comma.drafts.removeDraftAttachment, { conversationId, storageId });
  expect(await as.query(api.comma.queries.getDraft, { conversationId })).toBeNull();
});

test("sending a drafted attachment clears the draft, another attachment does not", async () => {
  const { t, as, conversationId } = await setup();
  const { storageId } = await stored(t);
  const other = await stored(t, "other.png");
  await t.mutation(internal.comma.drafts.prepareDraft, { conversationId, text: "caption", attachments: [storageId] });
  const send = (id: typeof storageId, clientKey: string) => as.mutation(api.comma.outbox.enqueue, {
    clientKey, conversationId, payload: { kind: "sendAttachment", storageId: id, filename: "photo.png", mimeType: "image/png", isAudioMessage: false },
  });
  await send(other.storageId, "a");
  expect(await as.query(api.comma.queries.getDraft, { conversationId })).not.toBeNull();
  await send(storageId, "b");
  expect(await as.query(api.comma.queries.getDraft, { conversationId })).toBeNull();
});

test("listDrafts lists every draft newest first and the agent list and delete touch only agent drafts", async () => {
  const { t, as, conversationId } = await setup();
  const second = await t.run((ctx) => ctx.db.insert("comma_conversations", {
    conversationKey: "dm:sam@example.com", primaryChatGuid: "iMessage;-;sam@example.com", chatGuids: ["iMessage;-;sam@example.com"],
    displayName: "Sam", isGroup: false, participants: [], lastMessageAt: 1, isSpam: false, hasGroupPhoto: false, updatedAt: 1,
  }));
  await t.run((ctx) => ctx.db.insert("comma_chat_aliases", { chatGuid: "iMessage;-;sam@example.com", conversationId: second, service: "iMessage" }));
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  await t.run((ctx) => ctx.db.insert("comma_drafts", { conversationId, text: "legacy", updatedAt: 500 }));
  const { storageId } = await stored(t);
  clock.mockReturnValue(2000);
  await t.mutation(internal.comma.drafts.prepareDraft, { address: "Sam@Example.com", text: "agent", note: "Line one\nLine two", attachments: [storageId] });
  expect(await as.query(api.comma.queries.listDrafts, {})).toEqual([
    { conversationId: second, text: "agent", updatedAt: 2000, source: "agent", note: "Line one\nLine two", attachmentCount: 1 },
    { conversationId, text: "legacy", updatedAt: 500, source: "user", attachmentCount: 0 },
  ]);
  expect((await t.query(internal.comma.drafts.listAgentDrafts, {})).map((d) => d.conversationId)).toEqual([second]);
  expect(await t.mutation(internal.comma.drafts.deleteAgentDraft, { conversationId })).toBe(false);
  expect(await t.mutation(internal.comma.drafts.deleteAgentDraft, { conversationId: second })).toBe(true);
  expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  expect((await as.query(api.comma.queries.listDrafts, {})).map((d) => d.conversationId)).toEqual([conversationId]);
  await expect(t.query(api.comma.queries.listDrafts, {})).rejects.toThrow("Unauthorized");
});
