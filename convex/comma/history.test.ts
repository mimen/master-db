import { makeFunctionReference, type ApiFromModules } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import type { Doc, Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";

import type { messageWindow } from "./history";
import { commaModules } from "./testModules.vitest";

const windowRef = makeFunctionReference("comma/history:messageWindow") as ApiFromModules<{ history: { messageWindow: typeof messageWindow } }>["history"]["messageWindow"];
const authed = () => convexTest(schema, commaModules).withIdentity({ email: ALLOWED_EMAIL });
const conversation = (key = "one") => ({
  conversationKey: `dm:${key}`, primaryChatGuid: key, chatGuids: [key], displayName: key,
  isGroup: false, participants: [], lastMessageAt: 0, isSpam: false, hasGroupPhoto: false, updatedAt: 0,
});
function message(id: Id<"comma_conversations">, date: number, guid = `m-${date}`): Omit<Doc<"comma_messages">, "_id" | "_creationTime"> {
  return {
    conversationId: id, guid, chatGuid: "one", dateCreated: date, isFromMe: false, text: "hello",
    service: "iMessage", error: 0, edited: false, retracted: false, isTapback: false,
    reactions: [], isGroupEvent: false, mentions: [], attachmentGuids: [], sourceVersion: 1,
  };
}
async function seed(t: ReturnType<typeof authed>, count = 100) {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("comma_conversations", conversation());
    const other = await ctx.db.insert("comma_conversations", conversation("other"));
    for (let date = 0; date < count; date++) await ctx.db.insert("comma_messages", message(id, date));
    await ctx.db.insert("comma_messages", message(other, 50, "other-chat"));
    return id;
  });
}

describe("message history windows", () => {
  test("strict before and after boundaries, ascending and capped at 40", async () => {
    const t = authed();
    const id = await seed(t);
    const before = await t.query(windowRef, { conversationId: id, before: 50 });
    const after = await t.query(windowRef, { conversationId: id, after: 50 });
    expect(before.map((m) => m.dateCreated)).toEqual(Array.from({ length: 40 }, (_, i) => i + 10));
    expect(after.map((m) => m.dateCreated)).toEqual(Array.from({ length: 40 }, (_, i) => i + 51));
    expect(await t.query(windowRef, { conversationId: id, before: 0 })).toEqual([]);
    expect(await t.query(windowRef, { conversationId: id, after: 99 })).toEqual([]);
  });

  test("around includes the anchor in its older half and handles the edges", async () => {
    const t = authed();
    const id = await seed(t);
    const rows = await t.query(windowRef, { conversationId: id, around: 50 });
    expect(rows.map((m) => m.dateCreated)).toEqual(Array.from({ length: 80 }, (_, i) => i + 11));
    expect((await t.query(windowRef, { conversationId: id, around: 0 })).map((m) => m.dateCreated))
      .toEqual(Array.from({ length: 41 }, (_, i) => i));
  });

  test("equal timestamps use stable index order in both directions and across the limit", async () => {
    const t = authed();
    const id = await t.run(async (ctx) => {
      const id = await ctx.db.insert("comma_conversations", conversation());
      for (let i = 0; i < 45; i++) await ctx.db.insert("comma_messages", message(id, 5, `tie-${i}`));
      return id;
    });
    const after = await t.query(windowRef, { conversationId: id, after: 4 });
    const before = await t.query(windowRef, { conversationId: id, before: 6 });
    expect(after.map((m) => m.guid)).toEqual(Array.from({ length: 40 }, (_, i) => `tie-${i}`));
    expect(before.map((m) => m.guid)).toEqual(Array.from({ length: 40 }, (_, i) => `tie-${i + 5}`));
    expect(await t.query(windowRef, { conversationId: id, around: 5 })).toEqual(before);
    expect(await t.query(windowRef, { conversationId: id, before: 5 })).toEqual([]);
    expect(await t.query(windowRef, { conversationId: id, after: 5 })).toEqual([]);
    expect(await t.query(windowRef, { conversationId: id, after: 4 })).toEqual(after);
  });

  test("tapbacks and retracted rows do not consume window slots", async () => {
    const t = authed();
    const id = await seed(t, 41);
    await t.run(async (ctx) => {
      for (let i = 0; i < 45; i++) {
        await ctx.db.insert("comma_messages", { ...message(id, 41 + i, `tap-${i}`), isTapback: true });
        await ctx.db.insert("comma_messages", { ...message(id, 41 + i, `retracted-${i}`), retracted: true });
      }
    });
    for (const bounds of [{ before: 100 }, { after: 0 }, { around: 40 }]) {
      const rows = await t.query(windowRef, { conversationId: id, ...bounds });
      expect(rows.map((m) => m.guid)).toEqual(Array.from({ length: 40 }, (_, i) => `m-${i + 1}`));
    }
  });

  test("joins storage URLs and embedded reactions, excluding hidden attachments", async () => {
    const t = authed();
    const seeded = await t.run(async (ctx) => {
      const id = await ctx.db.insert("comma_conversations", conversation());
      const reactions = [{ type: "love" as const, isFromMe: false, senderAddress: "them", senderName: "Them" }];
      await ctx.db.insert("comma_messages", { ...message(id, 1, "photo-message"), reactions });
      const thumb = await ctx.storage.store(new Blob(["thumbnail"]));
      const original = await ctx.storage.store(new Blob(["original"]));
      const attachment = { conversationId: id, messageGuid: "photo-message", isSticker: false, hideAttachment: false, isOnDisk: true, sourceVersion: 1 };
      await ctx.db.insert("comma_attachments", { ...attachment, guid: "photo", thumbStorageId: thumb, originalStorageId: original });
      await ctx.db.insert("comma_attachments", { ...attachment, guid: "not-uploaded" });
      await ctx.db.insert("comma_attachments", { ...attachment, guid: "hidden", hideAttachment: true });
      await ctx.db.insert("comma_attachments", { ...attachment, guid: "unrelated", messageGuid: "other" });
      return { id, reactions, thumbUrl: await ctx.storage.getUrl(thumb), originalUrl: await ctx.storage.getUrl(original) };
    });
    const [row] = await t.query(windowRef, { conversationId: seeded.id, around: 1 });
    expect(row.reactions).toEqual(seeded.reactions);
    expect(row.attachments.map((a) => a.guid)).toEqual(["photo", "not-uploaded"]);
    expect(row.attachments[0]).toMatchObject({ thumbUrl: seeded.thumbUrl, originalUrl: seeded.originalUrl });
    expect(row.attachments[1]).toMatchObject({ thumbUrl: null, originalUrl: null });
  });

  test("requires exactly one bound and rejects unauthenticated callers", async () => {
    const t = authed();
    const id = await seed(t, 0);
    for (const bounds of [{}, { before: 0, after: 0 }, { before: 0, around: 0 }, { after: 0, around: 0 }, { before: 0, after: 0, around: 0 }]) {
      await expect(t.query(windowRef, { conversationId: id, ...bounds })).rejects.toThrow("Exactly one");
    }
    await expect(convexTest(schema, commaModules).query(windowRef, { conversationId: id, around: 0 })).rejects.toThrow("Unauthorized");
  });
});
