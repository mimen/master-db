import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";

import { isSelf } from "./accounts";
import { IMESSAGE_ACCOUNT } from "./conversationIdentity";
import { commaModules } from "./testModules.vitest";

type T = TestConvex<typeof schema>;

const CHAT = "iMessage;-;+15550001111";

function conversationInput(chatGuid = CHAT) {
  return {
    conversationKey: "dm:+15550001111", chats: [{ chatGuid, lastMessageAt: 1000 }], displayName: "Alex",
    isGroup: false, participants: [{ address: "+15550001111", name: null }], isSpam: false, hasGroupPhoto: false, lastMessageAt: 1000,
  };
}

function posted(conversationId: Id<"comma_conversations">, guid: string, overrides: Record<string, unknown> = {}) {
  return {
    guid, conversationId, dateCreated: 1000, isFromMe: false, text: guid, sender: { address: "+15550001111", name: null },
    edited: false, retracted: false, isGroupEvent: false, mentions: [], attachmentGuids: [], sourceVersion: 1,
    imessage: { chatGuid: CHAT, service: "iMessage" as const, error: 0, isAssociatedMessage: false },
    ...overrides,
  };
}

/** The flat form a bridge built before accounts posts. */
function flat(conversationId: Id<"comma_conversations">, guid: string, overrides: Record<string, unknown> = {}) {
  const { imessage: _imessage, ...core } = posted(conversationId, guid, overrides);
  return { ...core, chatGuid: CHAT, service: "iMessage" as const, error: 0, isTapback: false };
}

/** A second account on iMessage, standing in for another workspace or mailbox. */
async function otherAccount(t: T) {
  return await t.mutation(internal.comma.accounts.ensure, { platform: "imessage", externalId: "other-mac", label: "Other" });
}

async function conversationIn(t: T, accountId?: Id<"comma_accounts">) {
  const map = await t.mutation(internal.comma.internal.upsertConversations, { ...(accountId ? { platform: "imessage" as const, accountId } : {}), conversations: [conversationInput()] });
  return map[CHAT]!;
}

describe("accounts", () => {
  test("a bridge without an account writes for the iMessage account, seeded once", async () => {
    const t = convexTest(schema, commaModules);
    const first = await conversationIn(t);
    await conversationIn(t);
    const accounts = await t.run((ctx) => ctx.db.query("comma_accounts").collect());
    expect(accounts).toMatchObject([{ platform: "imessage", externalId: "mini", selfHandles: [], health: "ok" }]);
    expect(await t.run((ctx) => ctx.db.get(first))).toMatchObject({ accountId: accounts[0]!._id });
    const named = await t.mutation(internal.comma.accounts.ensure, { platform: "imessage", externalId: "mini", label: "iMessage" });
    expect(named).toBe(accounts[0]!._id);
  });

  test("conversation keys and message guids are unique per account, not per platform", async () => {
    const t = convexTest(schema, commaModules);
    const other = await otherAccount(t);
    const mine = await conversationIn(t);
    const theirs = await conversationIn(t, other);
    expect(theirs).not.toBe(mine);
    await t.mutation(internal.comma.internal.upsertMessages, { messages: [posted(mine, "same-guid")] });
    await t.mutation(internal.comma.internal.upsertMessages, { platform: "imessage", accountId: other, messages: [posted(theirs, "same-guid")] });
    const rows = await t.run((ctx) => ctx.db.query("comma_messages").collect());
    expect(rows.map((row) => row.conversationId).sort()).toEqual([mine, theirs].sort());
  });

  test("a snapshot replaces only its own account's unread and scheduled state", async () => {
    const t = convexTest(schema, commaModules);
    const other = await otherAccount(t);
    await conversationIn(t);
    const theirs = await conversationIn(t, other);
    const scope = { platform: "imessage" as const, accountId: other };
    await t.mutation(internal.comma.internal.replaceUnread, { ...scope, chats: [{ chatGuid: CHAT, count: 2, firstAt: 900 }] });
    const item = { bbId: 7, chatGuid: CHAT, text: "later", sendAt: 5000, status: "pending" as const };
    await t.mutation(internal.comma.internal.replaceScheduled, { ...scope, items: [item] });

    await t.mutation(internal.comma.internal.replaceUnread, { chats: [] });
    await t.mutation(internal.comma.internal.replaceScheduled, { items: [] });

    expect((await t.run((ctx) => ctx.db.get(theirs)))?.unread).toEqual({ count: 2, firstAt: 900 });
    expect(await t.run((ctx) => ctx.db.query("comma_scheduled").collect())).toMatchObject([{ bbId: 7, accountId: other, conversationId: theirs }]);
  });

  test("a sync cursor from before accounts is adopted, not duplicated", async () => {
    const t = convexTest(schema, commaModules);
    await t.run((ctx) => ctx.db.insert("comma_sync_state", { key: "continuous", cursor: "1", updatedAt: 1 }));
    await t.mutation(internal.comma.internal.markSyncState, { key: "continuous", cursor: "2" });
    const rows = await t.run((ctx) => ctx.db.query("comma_sync_state").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "continuous", cursor: "2" });
    expect(rows[0]?.accountId).toBeDefined();
  });

  test("a self handle is the same handle by kind, or the same text where it has no match key", () => {
    expect(isSelf({ selfHandles: ["slack:U123", "me@example.com"] }, "ME@example.com")).toBe(true);
    expect(isSelf({ selfHandles: ["+15550009999"] }, "(555) 000-9999(smsfp)")).toBe(true);
    expect(isSelf({ selfHandles: ["slack:U123"] }, "slack:U123")).toBe(true);
    expect(isSelf({ selfHandles: ["slack:U123"] }, "slack:U999")).toBe(false);
    expect(isSelf({ selfHandles: ["24273"] }, "24273(smsfp)")).toBe(true);
    expect(isSelf({ selfHandles: [] }, undefined)).toBe(false);
  });

  test("iMessage reports its own from-me flag, so a self handle never turns an inbound copy into mine", async () => {
    const t = convexTest(schema, commaModules);
    await t.mutation(internal.comma.accounts.ensure, { ...IMESSAGE_ACCOUNT, selfHandles: ["+15550001111"] });
    const conversationId = await conversationIn(t);
    await t.mutation(internal.comma.internal.upsertMessages, { messages: [posted(conversationId, "note-to-self")] });
    const [message] = await t.run((ctx) => ctx.db.query("comma_messages").collect());
    expect(message).toMatchObject({ guid: "note-to-self", isFromMe: false });
  });

  test("a mention of one of the account's handles is addressed to me; anyone else's is not", async () => {
    const t = convexTest(schema, commaModules);
    await t.mutation(internal.comma.accounts.ensure, { ...IMESSAGE_ACCOUNT, selfHandles: ["+15550009999", "me@example.com"] });
    const conversationId = await conversationIn(t);
    await t.mutation(internal.comma.internal.upsertMessages, { messages: [
      posted(conversationId, "to-me", { mentions: [{ start: 0, length: 3, address: "(555) 000-9999" }] }),
      posted(conversationId, "to-me-by-email", { mentions: [{ start: 0, length: 3, address: "+15550002222" }, { start: 4, length: 2, address: "Me@Example.com" }] }),
      posted(conversationId, "to-them", { mentions: [{ start: 0, length: 3, address: "+15550002222" }] }),
      posted(conversationId, "plain"),
    ] });
    const rows = await t.run((ctx) => ctx.db.query("comma_messages").collect());
    expect(Object.fromEntries(rows.map((row) => [row.guid, row.mentionsMe]))).toEqual({
      "to-me": true, "to-me-by-email": true, "to-them": false, plain: false,
    });
  });

  test("the conversation's last message says whether it mentions me, and says nothing when it does not", async () => {
    const t = convexTest(schema, commaModules);
    await t.mutation(internal.comma.accounts.ensure, { ...IMESSAGE_ACCOUNT, selfHandles: ["+15550009999"] });
    const conversationId = await conversationIn(t);
    const last = async () => (await t.run((ctx) => ctx.db.get(conversationId)))?.lastMessage;
    await t.mutation(internal.comma.internal.upsertMessages, { messages: [
      posted(conversationId, "to-me", { dateCreated: 10, mentions: [{ start: 0, length: 3, address: "+15550009999" }] }),
    ] });
    expect(await last()).toMatchObject({ guid: "to-me", mentionsMe: true });
    await t.mutation(internal.comma.internal.upsertMessages, { messages: [posted(conversationId, "plain", { dateCreated: 20 })] });
    expect(await last()).toMatchObject({ guid: "plain" });
    expect(await last()).not.toHaveProperty("mentionsMe");
  });
});

describe("the neutral message form", () => {
  test("new ingest nests iMessage fields, and readers see them both nested and flat", async () => {
    const t = convexTest(schema, commaModules);
    const conversationId = await conversationIn(t);
    await t.mutation(internal.comma.internal.upsertMessages, { messages: [posted(conversationId, "m1", { imessage: {
      chatGuid: CHAT, service: "SMS", error: 0, isAssociatedMessage: false, sendEffect: "impact" } })] });
    const [row] = await t.run((ctx) => ctx.db.query("comma_messages").collect());
    expect(row).toMatchObject({ platform: "imessage", imessage: { chatGuid: CHAT, service: "SMS", sendEffect: "impact" } });
    expect(row?.chatGuid).toBeUndefined();

    const as = t.withIdentity({ email: ALLOWED_EMAIL });
    const page = await as.query(api.comma.queries.listMessages, { conversationId, paginationOpts: { numItems: 10, cursor: null } });
    expect(page.page[0]).toMatchObject({ imessage: { service: "SMS" }, chatGuid: CHAT, service: "SMS", isTapback: false, sendEffect: "impact" });
  });

  test("a write over a stored flat row nests its fields and leaves no flat copy", async () => {
    const t = convexTest(schema, commaModules);
    const conversationId = await conversationIn(t);
    // Rows from before accounts were stored flat; ingest now converts the flat form on the way in.
    await t.run((ctx) => ctx.db.insert("comma_messages", flat(conversationId, "m1")));
    await t.mutation(internal.comma.internal.upsertMessages, { messages: [posted(conversationId, "m1", { sourceVersion: 2, text: "edited" })] });
    const rows = await t.run((ctx) => ctx.db.query("comma_messages").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: "edited", imessage: { chatGuid: CHAT } });
    expect(rows[0]?.chatGuid).toBeUndefined();
    expect(rows[0]?.isTapback).toBeUndefined();
  });

  test("an associated message stays out of the thread in either form", async () => {
    const t = convexTest(schema, commaModules);
    const conversationId = await conversationIn(t);
    await t.mutation(internal.comma.internal.upsertMessages, { messages: [
      posted(conversationId, "shown", { dateCreated: 1 }),
      posted(conversationId, "nested", { dateCreated: 2, imessage: { chatGuid: CHAT, service: "iMessage", error: 0, isAssociatedMessage: true } }),
      { ...flat(conversationId, "flat", { dateCreated: 3 }), isTapback: true },
    ] });
    const as = t.withIdentity({ email: ALLOWED_EMAIL });
    const page = await as.query(api.comma.queries.listMessages, { conversationId, paginationOpts: { numItems: 10, cursor: null } });
    expect(page.page.map((row) => row.guid)).toEqual(["shown"]);
  });
});

describe("the accounts backfill", () => {
  test("a dry run counts, a real run nests and stamps, and a second run changes nothing", async () => {
    const t = convexTest(schema, commaModules);
    const conversationId = await t.run((ctx) => ctx.db.insert("comma_conversations", {
      platform: "imessage", conversationKey: "dm:+15550001111", primaryChatGuid: CHAT, chatGuids: [CHAT], displayName: "Alex",
      isGroup: false, participants: [], lastMessageAt: 1, isSpam: false, hasGroupPhoto: false, updatedAt: 1,
    }));
    await t.run(async (ctx) => {
      await ctx.db.insert("comma_chat_aliases", { chatGuid: CHAT, conversationId, service: "iMessage" });
      await ctx.db.insert("comma_messages", {
        guid: "old", conversationId, chatGuid: CHAT, dateCreated: 1, isFromMe: false, text: "hi", service: "iMessage", error: 0,
        edited: false, retracted: false, isTapback: false, reactions: [], isGroupEvent: false, mentions: [], attachmentGuids: [], sourceVersion: 1,
      });
      await ctx.db.insert("comma_attachments", {
        guid: "a1", messageGuid: "old", conversationId, transferName: "IMG.png", isSticker: false, hideAttachment: false, isOnDisk: true, sourceVersion: 1,
      });
    });
    const changed = (report: { table: string; changed: number }[]) => Object.fromEntries(report.map((row) => [row.table, row.changed]));

    const dry = await t.action(internal.comma.migrations.runAccountsBackfill, { dryRun: true });
    expect(changed(dry)).toEqual({ comma_conversations: 1, comma_chat_aliases: 1, comma_messages: 1, comma_attachments: 1, comma_scheduled: 0 });
    expect((await t.run((ctx) => ctx.db.query("comma_messages").collect()))[0]?.imessage).toBeUndefined();

    await t.action(internal.comma.migrations.runAccountsBackfill, { dryRun: false, limit: 1 });
    const [account] = await t.run((ctx) => ctx.db.query("comma_accounts").collect());
    const [message] = await t.run((ctx) => ctx.db.query("comma_messages").collect());
    expect(message).toMatchObject({ platform: "imessage", accountId: account!._id, imessage: { chatGuid: CHAT, service: "iMessage", error: 0, isAssociatedMessage: false } });
    expect(message?.chatGuid).toBeUndefined();
    expect(message?.reactions).toEqual([]);
    const [attachment] = await t.run((ctx) => ctx.db.query("comma_attachments").collect());
    expect(attachment).toMatchObject({ accountId: account!._id, imessage: { transferName: "IMG.png", isOnDisk: true, isSticker: false } });
    expect(attachment?.isOnDisk).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({ accountId: account!._id });

    const again = await t.action(internal.comma.migrations.runAccountsBackfill, { dryRun: false });
    expect(again.every((row) => row.changed === 0)).toBe(true);
  });
});
