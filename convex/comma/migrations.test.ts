import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../_generated/api";
import schema from "../schema";

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
