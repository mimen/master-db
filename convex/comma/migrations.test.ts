import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { reactionsOf } from "./reactionStore";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

type T = TestConvex<typeof schema>;

const base = { displayName: "Crew", isGroup: true, participants: [], lastMessageAt: 0, isSpam: false, hasGroupPhoto: false, updatedAt: 0 };

async function group(t: T, chatGuids: string[]): Promise<Id<"comma_conversations">> {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("comma_conversations", { ...base, conversationKey: `g:${chatGuids[0]}`, primaryChatGuid: chatGuids[0] ?? "", chatGuids });
    for (const chatGuid of chatGuids) await ctx.db.insert("comma_chat_aliases", { chatGuid, conversationId: id, service: chatGuid.split(";")[0] ?? "" });
    return id;
  });
}

const snapshot = (t: T) => t.run(async (ctx) => ({
  crm: (await ctx.db.query("chat_crm").collect()).map(({ chat_guid, conversation_id, is_favorite, priority }) => ({ chat_guid, conversation_id, is_favorite, priority })),
  tags: (await ctx.db.query("tags").collect()).map(({ chat_guid, conversation_id, person_id, tag }) => ({ chat_guid, conversation_id, person_id, tag })),
  events: (await ctx.db.query("event_links").collect()).map(({ chat_guid, conversation_id, airtable_event_id }) => ({ chat_guid, conversation_id, airtable_event_id })),
}));

test("rekeyGroupCrm moves group CRM onto conversations, merges siblings, and converges", async () => {
  const t = convexTest(schema, modules);
  const crew = await group(t, ["iMessage;+;crew", "SMS;+;crew"]);
  const solo = await group(t, ["iMessage;+;solo"]);
  const personId = await t.run((ctx) => ctx.db.insert("people", {
    display_name: "P", normalized_phones: [], normalized_emails: [], identity_count: 0, message_count: 0,
    is_self: false, auto_clustered: false, created_at: "x", updated_at: "x",
  }));
  await t.run(async (ctx) => {
    // The crew's CRM was written under each sibling GUID at different times; one row already moved.
    await ctx.db.insert("chat_crm", { chat_guid: "iMessage;+;crew", is_favorite: true, created_at: "1", updated_at: "1" });
    await ctx.db.insert("chat_crm", { chat_guid: "SMS;+;crew", priority: 2, created_at: "2", updated_at: "2" });
    await ctx.db.insert("chat_crm", { chat_guid: "iMessage;+;solo", conversation_id: solo, priority: 4, created_at: "1", updated_at: "1" });
    await ctx.db.insert("chat_crm", { chat_guid: "iMessage;+;gone", priority: 1, created_at: "1", updated_at: "1" });
    await ctx.db.insert("tags", { chat_guid: "iMessage;+;crew", tag: "planning", created_at: "1" });
    await ctx.db.insert("tags", { chat_guid: "SMS;+;crew", tag: "planning", created_at: "2" });
    await ctx.db.insert("tags", { chat_guid: "SMS;+;crew", tag: "music", created_at: "2" });
    await ctx.db.insert("tags", { person_id: personId, tag: "planning", created_at: "1" });
    await ctx.db.insert("event_links", { chat_guid: "iMessage;+;crew", airtable_event_id: "evt1", event_name: "Bash", created_at: "1" });
    await ctx.db.insert("event_links", { chat_guid: "SMS;+;crew", airtable_event_id: "evt1", event_name: "Bash", created_at: "2" });
  });
  const before = await snapshot(t);

  const dry = await t.mutation(internal.comma.migrations.rekeyGroupCrm, { dryRun: true });
  expect(dry).toEqual({
    moved: { chat_crm: 2, tags: 3, event_links: 2 },
    deleted: { chat_crm: 1, tags: 1, event_links: 1 },
    unresolved: ["iMessage;+;gone"],
  });
  expect(await snapshot(t)).toEqual(before);

  expect(await t.mutation(internal.comma.migrations.rekeyGroupCrm, { dryRun: false })).toEqual(dry);
  const after = await snapshot(t);
  expect(after.crm).toEqual(expect.arrayContaining([
    { chat_guid: "SMS;+;crew", conversation_id: crew, is_favorite: true, priority: 2 },
    { chat_guid: "iMessage;+;solo", conversation_id: solo, is_favorite: undefined, priority: 4 },
    { chat_guid: "iMessage;+;gone", conversation_id: undefined, is_favorite: undefined, priority: 1 },
  ]));
  expect(after.crm).toHaveLength(3);
  expect(after.tags.filter((row) => row.conversation_id === crew).map((row) => row.tag).sort()).toEqual(["music", "planning"]);
  expect(after.tags.filter((row) => row.person_id)).toHaveLength(1);
  expect(after.events).toEqual([{ chat_guid: "iMessage;+;crew", conversation_id: crew, airtable_event_id: "evt1" }]);

  expect(await t.mutation(internal.comma.migrations.rekeyGroupCrm, { dryRun: false })).toEqual({
    moved: { chat_crm: 0, tags: 0, event_links: 0 },
    deleted: { chat_crm: 0, tags: 0, event_links: 0 },
    unresolved: ["iMessage;+;gone"],
  });
  expect(await snapshot(t)).toEqual(after);
});

test("backfillConversationPlatform stamps only rows without a platform, page by page", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 250; i++) {
      await ctx.db.insert("comma_conversations", { ...base, ...(i === 0 ? { platform: "imessage" as const } : {}),
        conversationKey: `g:${i}`, primaryChatGuid: `iMessage;+;${i}`, chatGuids: [`iMessage;+;${i}`] });
    }
  });
  const dry = await t.mutation(internal.comma.migrations.backfillConversationPlatform, { dryRun: true, cursor: null });
  expect(dry).toMatchObject({ patched: 199, isDone: false });
  let cursor: string | null = null;
  let patched = 0;
  for (;;) {
    const page: { patched: number; cursor: string; isDone: boolean } =
      await t.mutation(internal.comma.migrations.backfillConversationPlatform, { dryRun: false, cursor });
    patched += page.patched;
    cursor = page.cursor;
    if (page.isDone) break;
  }
  expect(patched).toBe(249);
  const platforms = await t.run(async (ctx) => (await ctx.db.query("comma_conversations").collect()).map((row) => row.platform));
  expect(new Set(platforms)).toEqual(new Set(["imessage"]));
});

describe("legacy tapback rows", () => {
  const chatGuid = "iMessage;-;+15550001111";
  const row = { chatGuid, service: "iMessage" as const, error: 0, edited: false, retracted: false, reactions: [], isGroupEvent: false,
    mentions: [], attachmentGuids: [], text: "", sourceVersion: 1, sender: { address: "+15550001111", name: null } };

  /** A target with one sender's love, removed, then like; plus a sticker row that is not a reaction. */
  async function seedLegacy(t: T) {
    return await t.run(async (ctx) => {
      const conversationId = await ctx.db.insert("comma_conversations", { ...base, conversationKey: "dm:+15550001111", primaryChatGuid: chatGuid, chatGuids: [chatGuid] });
      const tapback = (guid: string, dateCreated: number, reaction: string, remove: boolean) => ctx.db.insert("comma_messages", {
        ...row, conversationId, guid, dateCreated, isFromMe: false, isTapback: true, tapbackTargetGuid: "m1", tapback: { targetGuid: "m1", reaction, remove },
      });
      await ctx.db.insert("comma_messages", { ...row, conversationId, guid: "m1", dateCreated: 1, isFromMe: false, isTapback: false, text: "hi",
        reactions: [{ type: "like", isFromMe: false, senderName: null, senderAddress: "+15550001111" }] });
      await tapback("tb3", 30, "like", false);
      await tapback("tb1", 10, "love", false);
      await tapback("tb2", 20, "love", true);
      await ctx.db.insert("comma_messages", { ...row, conversationId, guid: "sticker", dateCreated: 40, isFromMe: false, isTapback: true });
      return conversationId;
    });
  }
  const reactionRows = (t: T) => t.run(async (ctx) => (await ctx.db.query("comma_reactions").collect())
    .map(({ key, removed, at }) => ({ key, removed, at })).sort((a, b) => a.at - b.at));
  const messageGuids = (t: T) => t.run(async (ctx) => (await ctx.db.query("comma_messages").collect()).map((m) => m.guid).sort());

  test("backfillReactions derives the reactions in any row order, leaves the rows, and converges", async () => {
    const t = convexTest(schema, modules);
    await seedLegacy(t);
    expect(await t.mutation(internal.comma.migrations.backfillReactions, { dryRun: true, cursor: null }))
      .toMatchObject({ scanned: 3, applied: 3, isDone: true });
    expect(await reactionRows(t)).toEqual([]);
    expect(await t.mutation(internal.comma.migrations.backfillReactions, { dryRun: false, cursor: null })).toMatchObject({ scanned: 3, isDone: true });
    expect(await reactionRows(t)).toEqual([{ key: "love", removed: true, at: 20 }, { key: "like", removed: false, at: 30 }]);
    expect(await t.mutation(internal.comma.migrations.backfillReactions, { dryRun: false, cursor: null })).toMatchObject({ applied: 0 });
    expect(await messageGuids(t)).toEqual(["m1", "sticker", "tb1", "tb2", "tb3"]);
  });

  test("deleteLegacyTapbacks writes each row's reaction before it deletes the row, and keeps other associated rows", async () => {
    const t = convexTest(schema, modules);
    await seedLegacy(t);
    expect(await t.mutation(internal.comma.migrations.deleteLegacyTapbacks, { dryRun: true, cursor: null }))
      .toMatchObject({ scanned: 3, deleted: 3, isDone: true });
    expect(await messageGuids(t)).toHaveLength(5);
    expect(await t.mutation(internal.comma.migrations.deleteLegacyTapbacks, { dryRun: false, cursor: null }))
      .toMatchObject({ deleted: 3, isDone: true });
    expect(await messageGuids(t)).toEqual(["m1", "sticker"]);
    expect(await reactionRows(t)).toEqual([{ key: "love", removed: true, at: 20 }, { key: "like", removed: false, at: 30 }]);
    const shown = await t.run(async (ctx) => reactionsOf(ctx, (await ctx.db.query("comma_messages").withIndex("by_guid", (q) => q.eq("guid", "m1")).unique())!));
    expect(shown.map((r) => r.key)).toEqual(["like"]);
  });
});
