import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

import { ensureAccount } from "./accounts";
import { IMESSAGE_ACCOUNT } from "./conversationIdentity";
import { messageKey } from "./reactions";

import { commaModules } from "./testModules.vitest";

function conversation(key: string, isGroup: boolean) {
  const chatGuid = `iMessage;${isGroup ? "+" : "-"};${key}`;
  return {
    platform: "imessage" as const, conversationKey: `${isGroup ? "g" : "dm"}:${key}`, primaryChatGuid: chatGuid, chatGuids: [chatGuid],
    displayName: key, isGroup, participants: [], lastMessageAt: 1, isSpam: false, hasGroupPhoto: false, updatedAt: 1,
  };
}

describe("conversation kinds", () => {
  test("ingest derives an iMessage conversation's kind and keeps isGroup in step", async () => {
    const t = convexTest(schema, commaModules);
    const ids = await t.mutation(internal.comma.internal.upsertConversations, { conversations: [
      { conversationKey: "dm:+15550001111", chats: [{ chatGuid: "iMessage;-;+15550001111", lastMessageAt: 1 }], displayName: "Alex",
        isGroup: false, participants: [{ address: "+15550001111", name: null }], isSpam: false, hasGroupPhoto: false, lastMessageAt: 1 },
      { conversationKey: "g:chat1", chats: [{ chatGuid: "iMessage;+;chat1", lastMessageAt: 1 }], displayName: "Crew",
        isGroup: true, participants: [], isSpam: false, hasGroupPhoto: false, lastMessageAt: 1 },
    ] });
    const dm = await t.run((ctx) => ctx.db.get(ids["iMessage;-;+15550001111"]!));
    const group = await t.run((ctx) => ctx.db.get(ids["iMessage;+;chat1"]!));
    expect(dm).toMatchObject({ kind: "dm", isGroup: false });
    expect(group).toMatchObject({ kind: "group", isGroup: true });
  });

  test("the backfill reports first, then stamps every row from before kinds once, page by page", async () => {
    const t = convexTest(schema, commaModules);
    const [dm, group, stamped] = await t.run(async (ctx) => [
      await ctx.db.insert("comma_conversations", conversation("+15550001111", false)),
      await ctx.db.insert("comma_conversations", conversation("chat1", true)),
      await ctx.db.insert("comma_conversations", { ...conversation("chat2", true), kind: "group" as const }),
    ]);

    expect(await t.action(internal.comma.migrations.runKindsBackfill, { dryRun: true })).toEqual({ scanned: 3, changed: 2 });
    expect((await t.run((ctx) => ctx.db.get(dm)))?.kind).toBeUndefined();

    expect(await t.action(internal.comma.migrations.runKindsBackfill, { dryRun: false, limit: 1 })).toEqual({ scanned: 3, changed: 2 });
    const kinds = await t.run(async (ctx) => [(await ctx.db.get(dm))?.kind, (await ctx.db.get(group))?.kind, (await ctx.db.get(stamped))?.kind]);
    expect(kinds).toEqual(["dm", "group", "group"]);

    expect(await t.action(internal.comma.migrations.runKindsBackfill, { dryRun: false })).toEqual({ scanned: 3, changed: 0 });
  });
});

describe("the unlisted backfill", () => {
  test("reports first, then stamps email threads and unfollowed Slack threads once, and nothing the Messages list shows", async () => {
    const t = convexTest(schema, commaModules);
    const ids = await t.run(async (ctx) => {
      const base = { isGroup: true, participants: [], lastMessageAt: 1, isSpam: false, updatedAt: 1, displayName: "x" };
      const insert = (row: object) => ctx.db.insert("comma_conversations", { ...base, ...row } as typeof base & { conversationKey: string });
      return {
        dm: await ctx.db.insert("comma_conversations", conversation("+15550001111", false)),
        email: await insert({ platform: "gmail", conversationKey: "gm:t1", kind: "emailThread", gmail: { threadId: "t1", subject: "s", inInbox: true, bulk: false } }),
        stamped: await insert({ platform: "gmail", conversationKey: "gm:t2", kind: "emailThread", unlisted: true, gmail: { threadId: "t2", subject: "s", inInbox: false, bulk: false } }),
        unfollowed: await insert({ platform: "slack", conversationKey: "th:C1:1", kind: "thread", slack: { channel: "C1", threadTs: "1", following: false } }),
        followed: await insert({ platform: "slack", conversationKey: "th:C1:2", kind: "thread", slack: { channel: "C1", threadTs: "2", following: true } }),
        channel: await insert({ platform: "slack", conversationKey: "ch:C1", kind: "channel", slack: { channel: "C1" } }),
      };
    });
    const unlisted = () => t.run(async (ctx) => Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([name, id]) => [name, (await ctx.db.get(id))?.unlisted]))));

    expect(await t.action(internal.comma.migrations.runUnlistedBackfill, { dryRun: true })).toEqual({ scanned: 6, changed: 2 });
    expect((await unlisted()).email).toBeUndefined();
    expect(await t.action(internal.comma.migrations.runUnlistedBackfill, { dryRun: false, limit: 2 })).toEqual({ scanned: 6, changed: 2 });
    expect(await unlisted()).toEqual({ dm: undefined, email: true, stamped: true, unfollowed: true, followed: undefined, channel: undefined });
    expect(await t.action(internal.comma.migrations.runUnlistedBackfill, { dryRun: false })).toEqual({ scanned: 6, changed: 0 });
  });
});

describe("the Slack threads backfill", () => {
  test("reports first, then restamps old thread rows and moves a DM's inline replies into their thread, once", async () => {
    const t = convexTest(schema, commaModules);
    const { accountId, dm, oldThread } = await t.run(async (ctx) => {
      const accountId = await ctx.db.insert("comma_accounts", {
        platform: "slack", externalId: "T1", label: "AUF", selfHandles: ["slack:UME"], health: "ok", createdAt: 1,
      });
      const slackRow = (conversationKey: string, kind: "dm" | "group", slack: { channel: string; threadTs?: string }) => ({
        platform: "slack" as const, accountId, conversationKey, kind, isGroup: kind !== "dm", slack, displayName: "x",
        participants: [], lastMessageAt: 1, isSpam: false, updatedAt: 1,
      });
      const dm = await ctx.db.insert("comma_conversations", slackRow("im:D1", "dm", { channel: "D1" }));
      const oldThread = await ctx.db.insert("comma_conversations", slackRow("th:C1:5.0", "group", { channel: "C1", threadTs: "5.0" }));
      const row = (conversationId: typeof dm, guid: string, at: number, threadRef?: string, sender = "slack:USAM") => ({
        platform: "slack" as const, accountId, conversationId, guid, dateCreated: at, isFromMe: sender === "slack:UME",
        sender: { address: sender, name: null }, text: guid, edited: false, retracted: false, isGroupEvent: false, mentions: [],
        attachmentGuids: [], sourceVersion: 0, ...(threadRef ? { threadRef } : {}),
      });
      await ctx.db.insert("comma_messages", row(dm, "D1:1.0", 1000, undefined, "slack:UME"));
      await ctx.db.insert("comma_messages", row(dm, "D1:2.0", 2000, "1.0"));
      await ctx.db.insert("comma_messages", row(dm, "D1:3.0", 3000, "1.0", "slack:UME"));
      await ctx.db.insert("comma_messages", row(oldThread, "C1:5.0", 5000));
      await ctx.db.insert("comma_messages", row(oldThread, "C1:6.0", 6000, "5.0"));
      return { accountId, dm, oldThread };
    });

    expect(await t.action(internal.comma.migrations.runSlackThreadsBackfill, { dryRun: true })).toEqual({ scanned: 2, changed: 3 });
    expect((await t.run((ctx) => ctx.db.query("comma_conversations").collect())).length).toBe(2);
    expect(await t.action(internal.comma.migrations.runSlackThreadsBackfill, { dryRun: false, limit: 1 })).toMatchObject({ changed: 3 });

    const rows = await t.run((ctx) => ctx.db.query("comma_conversations").collect());
    const dmThread = rows.find((row) => row.conversationKey === "th:D1:1.0");
    expect(dmThread).toMatchObject({ accountId, kind: "thread", slack: { channel: "D1", threadTs: "1.0", following: true }, participants: [{ address: "slack:USAM" }] });
    expect(rows.find((row) => row._id === oldThread)).toMatchObject({ kind: "thread", slack: { following: true } });
    const messages = await t.run((ctx) => ctx.db.query("comma_messages").collect());
    const where = Object.fromEntries(messages.map((message) => [message.guid, message.conversationId === dm ? "dm" : message.conversationId === oldThread ? "old" : "new"]));
    expect(where).toEqual({ "D1:1.0": "dm", "D1:2.0": "new", "D1:3.0": "new", "C1:5.0": "old", "C1:6.0": "old" });
    expect(Object.fromEntries(messages.filter((message) => message.replyCount !== undefined).map((message) => [message.guid, message.replyCount])))
      .toEqual({ "D1:1.0": 2, "C1:5.0": 1 });
    expect(rows.find((row) => row._id === dm)!.lastMessage?.guid).toBe("D1:1.0");
    expect(dmThread!.lastMessage?.guid).toBe("D1:3.0");

    expect(await t.action(internal.comma.migrations.runSlackThreadsBackfill, { dryRun: false })).toEqual({ scanned: 3, changed: 0 });
  });
});

describe("the reaction keys backfill", () => {
  test("reports first, then keys each old reaction by its conversation's account once, keeping the newer of two states", async () => {
    const t = convexTest(schema, commaModules);
    const { slackAccount, imessageAccount, rows } = await t.run(async (ctx) => {
      const imessageAccount = (await ensureAccount(ctx, IMESSAGE_ACCOUNT))._id;
      const slackAccount = await ctx.db.insert("comma_accounts", {
        platform: "slack", externalId: "T1", label: "AUF", selfHandles: [], health: "ok", createdAt: 1,
      });
      const oldChat = await ctx.db.insert("comma_conversations", conversation("+15550001111", false));
      const slackDm = await ctx.db.insert("comma_conversations", {
        platform: "slack", accountId: slackAccount, conversationKey: "dm:U1", kind: "dm", isGroup: false, slack: { channel: "D1" },
        displayName: "x", participants: [], lastMessageAt: 1, isSpam: false, updatedAt: 1,
      });
      const reaction = (conversationId: Id<"comma_conversations">, platform: "imessage" | "slack", targetKey: string, at: number) =>
        ctx.db.insert("comma_reactions", { platform, conversationId, targetKey, key: "love", emoji: "❤️", isFromMe: true, at, removed: false });
      return { slackAccount, imessageAccount, rows: {
        legacy: await reaction(oldChat, "imessage", "imessage:p:0/GUID-1", 1),
        slack: await reaction(slackDm, "slack", "slack:D1:1.0001", 5),
        // An event that landed after the deploy, newer than the old row for the same sender and key.
        twinOld: await reaction(oldChat, "imessage", "imessage:GUID-2", 1),
        twinNew: await reaction(oldChat, "imessage", messageKey("imessage", imessageAccount, "GUID-2"), 9),
      } };
    });

    expect(await t.action(internal.comma.migrations.runReactionKeysBackfill, { dryRun: true })).toEqual({ scanned: 4, changed: 3 });
    expect((await t.run((ctx) => ctx.db.get(rows.legacy)))?.targetKey).toBe("imessage:p:0/GUID-1");

    expect(await t.action(internal.comma.migrations.runReactionKeysBackfill, { dryRun: false, limit: 2 })).toEqual({ scanned: 4, changed: 3 });
    const after = await t.run(async (ctx) => Promise.all([rows.legacy, rows.slack, rows.twinOld, rows.twinNew].map((id) => ctx.db.get(id))));
    expect(after.map((row) => row && { targetKey: row.targetKey, at: row.at })).toEqual([
      { targetKey: messageKey("imessage", imessageAccount, "p:0/GUID-1"), at: 1 },
      { targetKey: messageKey("slack", slackAccount, "D1:1.0001"), at: 5 },
      null,
      { targetKey: messageKey("imessage", imessageAccount, "GUID-2"), at: 9 },
    ]);

    expect(await t.action(internal.comma.migrations.runReactionKeysBackfill, { dryRun: false })).toEqual({ scanned: 3, changed: 0 });
  });
});
