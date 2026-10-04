import { makeFunctionReference, type ApiFromModules } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";

import type * as Media from "./media";
import { commaModules } from "./testModules.vitest";

const gallery = makeFunctionReference("comma/media:gallery") as ApiFromModules<{ media: typeof Media }>["media"]["gallery"];
const attachmentMedia = makeFunctionReference("comma/media:attachmentMedia") as ApiFromModules<{ media: typeof Media }>["media"]["attachmentMedia"];
const attachmentChatGuid = makeFunctionReference("comma/media:attachmentChatGuid") as ApiFromModules<{ media: typeof Media }>["media"]["attachmentChatGuid"];
const transcriptState = makeFunctionReference("comma/media:transcriptState") as ApiFromModules<{ media: typeof Media }>["media"]["transcriptState"];
const bridgeMedia = makeFunctionReference("comma/media:bridgeMedia") as unknown as ApiFromModules<{ media: typeof Media }>["media"]["bridgeMedia"];
const modules = { ...commaModules, "../../comma/media.ts": () => import("./media") };
const setup = () => convexTest(schema, modules).withIdentity({ email: ALLOWED_EMAIL });
async function seed(t: ReturnType<typeof setup>, count = 1) {
  return t.run(async (ctx) => {
    const conversationId = await ctx.db.insert("comma_conversations", { conversationKey: "dm:a", primaryChatGuid: "iMessage;-;a", chatGuids: ["iMessage;-;a"], displayName: "a", isGroup: false, participants: [], lastMessageAt: 0, isSpam: false, hasGroupPhoto: false, updatedAt: 1 });
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("comma_messages", { guid: `m${i}`, conversationId, chatGuid: "iMessage;-;a", dateCreated: i, isFromMe: false, text: "", service: "iMessage", error: 0, edited: false, retracted: false, isTapback: false, reactions: [], isGroupEvent: false, mentions: [], attachmentGuids: [`a${i}`], sourceVersion: 1 });
      await ctx.db.insert("comma_attachments", { guid: `a${i}`, messageGuid: `m${i}`, conversationId, filename: `photo${i}.jpg`, mimeType: "image/jpeg", hideAttachment: false, isSticker: false, isOnDisk: true, sourceVersion: 1 });
    }
    return conversationId;
  });
}

describe("media queries", () => {
  test("authenticate all public queries", async () => {
    const t = convexTest(schema, modules);
    const conversationId = await seed(t.withIdentity({ email: ALLOWED_EMAIL }));
    await expect(t.query(gallery, { conversationId })).rejects.toThrow("Unauthorized");
    await expect(t.query(attachmentMedia, { guid: "a0" })).rejects.toThrow("Unauthorized");
    await expect(t.query(attachmentChatGuid, { guid: "a0" })).rejects.toThrow("Unauthorized");
    await expect(t.query(transcriptState, { attachmentGuid: "a0" })).rejects.toThrow("Unauthorized");
  });
  test("orders newest first and enforces the 120 cap even within one message", async () => {
    const t = setup(); const conversationId = await seed(t, 125);
    const rows = await t.query(gallery, { conversationId, limit: 200 });
    expect(rows).toHaveLength(120);
    expect(rows.map((a) => a.dateCreated)).toEqual(Array.from({ length: 120 }, (_, i) => 124 - i));
    expect(rows[0]).toMatchObject({ guid: "a124", thumbUrl: null, originalUrl: null });
    expect(await t.query(gallery, { conversationId, limit: 2 })).toHaveLength(2);
    expect(await t.query(gallery, { conversationId, limit: 0 })).toEqual([]);
    await t.run(async (ctx) => {
      for (const message of await ctx.db.query("comma_messages").collect()) await ctx.db.patch(message._id, { guid: message.guid === "m124" ? "one" : message.guid, retracted: message.guid !== "m124" });
      for (const a of await ctx.db.query("comma_attachments").collect()) await ctx.db.patch(a._id, { messageGuid: "one" });
    });
    expect(await t.query(gallery, { conversationId })).toHaveLength(120);
  });
  test("filters hidden media, retracted messages, and duplicate renditions", async () => {
    const t = setup(); const conversationId = await seed(t, 3);
    await t.run(async (ctx) => {
      const attachments = await ctx.db.query("comma_attachments").collect();
      await ctx.db.patch(attachments[0]._id, { hideAttachment: true });
      const m1 = await ctx.db.query("comma_messages").withIndex("by_guid", (q) => q.eq("guid", "m1")).unique();
      await ctx.db.patch(m1!._id, { retracted: true });
      await ctx.db.patch(attachments[2]._id, { transferName: "photo.HEIC.jpeg" });
      await ctx.db.insert("comma_attachments", { ...Object.fromEntries(Object.entries(attachments[2]).filter(([k]) => k !== "_id" && k !== "_creationTime")), guid: "heic", transferName: "photo.HEIC", mimeType: "image/heic" } as Omit<typeof attachments[2], "_id" | "_creationTime">);
    });
    expect((await t.query(gallery, { conversationId })).map((a) => a.guid)).toEqual(["a2"]);
  });
  test("returns null URLs until storage exists and after storage is deleted", async () => {
    const t = setup(); await seed(t);
    expect(await t.query(attachmentMedia, { guid: "missing" })).toBeNull();
    expect(await t.query(attachmentChatGuid, { guid: "missing" })).toBeNull();
    expect(await t.query(attachmentChatGuid, { guid: "a0" })).toBe("iMessage;-;a");
    expect(await t.query(attachmentMedia, { guid: "a0" })).toEqual({ guid: "a0", thumbUrl: null, originalUrl: null });
    const storageId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["image"], { type: "image/jpeg" }));
      const a = await ctx.db.query("comma_attachments").unique();
      await ctx.db.patch(a!._id, { originalStorageId: storageId, thumbStorageId: storageId });
      return storageId;
    });
    expect((await t.query(attachmentMedia, { guid: "a0" }))?.originalUrl).toMatch(/^https?:/);
    await t.run((ctx) => ctx.storage.delete(storageId));
    expect((await t.query(attachmentMedia, { guid: "a0" }))?.originalUrl).toBeNull();
  });
});

test("transcripts mirror working, failure, retry, and ready and clear stale errors", async () => {
  const t = setup(); const conversationId = await seed(t);
  const attachmentGuid = "a0";
  expect(await t.query(transcriptState, { attachmentGuid })).toEqual({ state: "not-requested" });
  for (const transcript of [{ state: "working" as const }, { state: "failed" as const, error: "download failed" }, { state: "working" as const }, { state: "ready" as const, text: "hello" }]) {
    expect(await t.mutation(bridgeMedia, { request: { kind: "transcript", conversationId, attachmentGuid, transcript } })).toBe(true);
    expect(await t.query(transcriptState, { attachmentGuid })).toEqual(transcript);
  }
  await t.mutation(bridgeMedia, { request: { kind: "transcript", attachmentGuid, transcript: { state: "working" } } });
  expect(await t.query(transcriptState, { attachmentGuid })).toEqual({ state: "ready", text: "hello" });
  expect(await t.run(async (ctx) => (await ctx.db.query("comma_attachments").unique())?.transcriptError ?? null)).toBeNull();
  expect(await t.mutation(bridgeMedia, { request: { kind: "transcript", attachmentGuid: "missing", transcript: { state: "working" } } })).toBe(false);
  const other = await t.run((ctx) => ctx.db.insert("comma_conversations", { conversationKey: "dm:b", primaryChatGuid: "b", chatGuids: ["b"], displayName: "b", isGroup: false, participants: [], lastMessageAt: 0, isSpam: false, hasGroupPhoto: false, updatedAt: 1 }));
  await expect(t.mutation(bridgeMedia, { request: { kind: "transcript", conversationId: other, attachmentGuid, transcript: { state: "working" } } })).rejects.toThrow("belong");
});

test("bridge capability produces unavailable transcripts", async () => {
  const t = setup(); await seed(t);
  await t.run((ctx) => ctx.db.insert("comma_bridge_state", { key: "mini", privateApi: false, suggestions: false, reactionSuggestions: false, whisperAvailable: false, whisperDetail: "no model", lastSeenAt: 1 }));
  expect(await t.query(transcriptState, { attachmentGuid: "a0" })).toEqual({ state: "unavailable", detail: "no model" });
});

test("download verifies finalization, metadata, storage, and links each upload to one command", async () => {
  const t = setup(); const conversationId = await seed(t);
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["image"], { type: "image/jpeg" })));
  const commandId = await t.run((ctx) => ctx.db.insert("comma_outbox", { clientKey: "upload", conversationId, payload: { kind: "sendAttachment", storageId, filename: "photo.jpg", mimeType: "image/jpeg", isAudioMessage: false }, status: "claimed", attempts: 1, createdAt: 1, updatedAt: 1 }));
  const request = { kind: "upload" as const, storageId, commandId };
  await expect(t.mutation(bridgeMedia, { request })).rejects.toThrow("Finalized");
  const uploadId = await t.run((ctx) => ctx.db.insert("comma_uploads", { storageId, filename: "wrong.jpg", mimeType: "image/jpeg", totalBytes: 5, createdAt: 1 }));
  await expect(t.mutation(bridgeMedia, { request })).rejects.toThrow("metadata");
  await t.run((ctx) => ctx.db.patch(uploadId, { filename: "photo.jpg" }));
  expect(await t.mutation(bridgeMedia, { request })).toMatch(/^https?:/);
  expect((await t.run((ctx) => ctx.db.get(uploadId)))?.commandId).toBe(commandId);
  const otherCommand = await t.run(async (ctx) => { const original = await ctx.db.get(commandId); const { _id, _creationTime, ...fields } = original!; return ctx.db.insert("comma_outbox", { ...fields, clientKey: "other" }); });
  await expect(t.mutation(bridgeMedia, { request: { ...request, commandId: otherCommand } })).rejects.toThrow("another");
  await t.run((ctx) => ctx.storage.delete(storageId));
  await expect(t.mutation(bridgeMedia, { request })).rejects.toThrow("not found");
});
