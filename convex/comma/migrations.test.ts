import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

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
