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
