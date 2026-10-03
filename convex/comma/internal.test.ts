import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { conversationKey } from "./conversationKey";
import { choosePrimary } from "./internal";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

type T = TestConvex<typeof schema>;

async function seedDm(t: T, address: string, chats: { chatGuid: string; lastMessageAt: number }[]) {
  const key = conversationKey({
    isGroup: false,
    primaryChatGuid: chats[0]!.chatGuid,
    participants: [{ address, name: null }],
  });
  const map = await t.mutation(internal.comma.internal.upsertConversations, {
    conversations: [
      {
        conversationKey: key,
        chats,
        displayName: address,
        isGroup: false,
        participants: [{ address, name: null }],
        isSpam: false,
        hasGroupPhoto: false,
        lastMessageAt: Math.max(...chats.map((c) => c.lastMessageAt)),
      },
    ],
  });
  return map[chats[0]!.chatGuid]!;
}

function message(conversationId: Id<"comma_conversations">, guid: string, overrides: Record<string, unknown> = {}) {
  return {
    guid,
    conversationId,
    chatGuid: "iMessage;-;+15550001111",
    dateCreated: 1000,
    isFromMe: false,
    text: guid,
    service: "iMessage" as const,
    sender: { address: "+15550001111", name: "Alex" },
    error: 0,
    edited: false,
    retracted: false,
    isTapback: false,
    reactions: [],
    isGroupEvent: false,
    mentions: [],
    attachmentGuids: [],
    sourceVersion: 1,
    ...overrides,
  };
}

function tapbackRow(conversationId: Id<"comma_conversations">, guid: string, targetGuid: string, extra: Record<string, unknown>) {
  const { reaction = "love", emoji, remove = false, ...rest } = extra as {
    reaction?: string;
    emoji?: string;
    remove?: boolean;
  } & Record<string, unknown>;
  return message(conversationId, guid, {
    isTapback: true,
    tapbackTargetGuid: targetGuid,
    tapback: { targetGuid, reaction, remove, ...(emoji ? { emoji } : {}) },
    text: "",
    ...rest,
  });
}

describe("choosePrimary", () => {
  test("is independent of input order on equal timestamps", () => {
    const a = { chatGuid: "SMS;-;+15550001111", lastMessageAt: 2000 };
    const b = { chatGuid: "iMessage;-;+15550001111", lastMessageAt: 2000 };
    expect(choosePrimary([a, b])).toBe("iMessage;-;+15550001111");
    expect(choosePrimary([b, a])).toBe("iMessage;-;+15550001111");
  });

  test("newest activity wins over service preference", () => {
    expect(
      choosePrimary([
        { chatGuid: "iMessage;-;+15550001111", lastMessageAt: 1000 },
        { chatGuid: "SMS;-;+15550001111", lastMessageAt: 3000 },
      ]),
    ).toBe("SMS;-;+15550001111");
  });
});

describe("upsertConversations", () => {
  test("corrects a legacy numeric key without duplicating or moving references", async () => {
    const t = convexTest(schema, modules);
    const chatGuid = "SMS;-;900080006201";
    const input = { conversationKey: "dm:+900080006201", chats: [{ chatGuid, lastMessageAt: 1000 }],
      displayName: "900080006201", isGroup: false, participants: [{ address: "900080006201", name: null }],
      isSpam: false, hasGroupPhoto: false, lastMessageAt: 1000 };
    const first = (await t.mutation(internal.comma.internal.upsertConversations, { conversations: [input] }))[chatGuid]!;
    await t.mutation(internal.comma.internal.upsertMessages, { messages: [message(first, "legacy-message", { chatGuid })] });
    await t.run((ctx) => ctx.db.insert("comma_drafts", { conversationId: first, text: "draft", updatedAt: 1000 }));
    const updated = { ...input, conversationKey: "dm:900080006201" };
    const second = (await t.mutation(internal.comma.internal.upsertConversations, { conversations: [updated] }))[chatGuid];
    expect(second).toBe(first);
    await t.mutation(internal.comma.internal.upsertConversations, { conversations: [updated] });
    const rows = await t.run((ctx) => ctx.db.query("comma_conversations").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].conversationKey).toBe("dm:900080006201");
    expect(rows[0].lastMessage?.guid).toBe("legacy-message");
    const aliases = await t.run((ctx) => ctx.db.query("comma_chat_aliases").collect());
    expect(aliases[0].conversationId).toBe(first);
    const drafts = await t.run((ctx) => ctx.db.query("comma_drafts").collect());
    expect(drafts[0].conversationId).toBe(first);
  });
  test("keeps numbers from different countries apart", async () => {
    const t = convexTest(schema, modules);
    const us = await seedDm(t, "+15550001111", [{ chatGuid: "SMS;-;+15550001111", lastMessageAt: 2000 }]);
    const uk = await seedDm(t, "+445550001111", [{ chatGuid: "iMessage;-;+445550001111", lastMessageAt: 1000 }]);
    expect(us).not.toBe(uk);
  });

  test("re-points an alias that moved to another conversation", async () => {
    const t = convexTest(schema, modules);
    const first = await seedDm(t, "+15550001111", [{ chatGuid: "SMS;-;+15550002222", lastMessageAt: 1 }]);
    const second = await seedDm(t, "+15550003333", [{ chatGuid: "SMS;-;+15550002222", lastMessageAt: 2 }]);
    const alias = await t.run((ctx) =>
      ctx.db
        .query("comma_chat_aliases")
        .withIndex("by_chatGuid", (q) => q.eq("chatGuid", "SMS;-;+15550002222"))
        .unique(),
    );
    expect(first).not.toBe(second);
    expect(alias?.conversationId).toBe(second);
  });
});

describe("upsertMessages", () => {
  test("skips rows whose sourceVersion is not newer", async () => {
    const t = convexTest(schema, modules);
    const c = await seedDm(t, "+15550001111", [{ chatGuid: "iMessage;-;+15550001111", lastMessageAt: 1000 }]);
    await t.mutation(internal.comma.internal.upsertMessages, { messages: [message(c, "m1", { sourceVersion: 5 })] });
    const result = await t.mutation(internal.comma.internal.upsertMessages, {
      messages: [message(c, "m1", { text: "stale", sourceVersion: 5 })],
    });
    expect(result).toEqual({ written: 0, skipped: 1 });
    const row = await t.run((ctx) => ctx.db.query("comma_messages").withIndex("by_guid", (q) => q.eq("guid", "m1")).unique());
    expect(row?.text).toBe("m1");
  });

  test("a tapback that arrives before its target folds once the target lands", async () => {
    const t = convexTest(schema, modules);
    const c = await seedDm(t, "+15550001111", [{ chatGuid: "iMessage;-;+15550001111", lastMessageAt: 1000 }]);
    await t.mutation(internal.comma.internal.upsertMessages, {
      messages: [tapbackRow(c, "tb1", "m1", { dateCreated: 1100, emoji: "😍", reaction: "emoji" })],
    });
    await t.mutation(internal.comma.internal.upsertMessages, { messages: [message(c, "m1")] });
    const target = await t.run((ctx) => ctx.db.query("comma_messages").withIndex("by_guid", (q) => q.eq("guid", "m1")).unique());
    expect(target?.reactions).toEqual([
      { type: "emoji", emoji: "😍", isFromMe: false, senderName: "Alex", senderAddress: "+15550001111" },
    ]);
  });

  test("a removal drops the same sender's matching reaction", async () => {
    const t = convexTest(schema, modules);
    const c = await seedDm(t, "+15550001111", [{ chatGuid: "iMessage;-;+15550001111", lastMessageAt: 1000 }]);
    await t.mutation(internal.comma.internal.upsertMessages, {
      messages: [
        message(c, "m1"),
        tapbackRow(c, "tb1", "m1", { dateCreated: 1100, isFromMe: true, sender: undefined }),
        tapbackRow(c, "tb2", "m1", { dateCreated: 1200, isFromMe: true, sender: undefined, remove: true }),
      ],
    });
    const target = await t.run((ctx) => ctx.db.query("comma_messages").withIndex("by_guid", (q) => q.eq("guid", "m1")).unique());
    expect(target?.reactions).toEqual([]);
  });

  test("lastMessage ignores tapbacks and retracted messages", async () => {
    const t = convexTest(schema, modules);
    const c = await seedDm(t, "+15550001111", [{ chatGuid: "iMessage;-;+15550001111", lastMessageAt: 1000 }]);
    await t.mutation(internal.comma.internal.upsertMessages, {
      messages: [
        message(c, "m1", { dateCreated: 1000 }),
        message(c, "m2", { dateCreated: 2000, retracted: true }),
        tapbackRow(c, "tb1", "m1", { dateCreated: 3000 }),
      ],
    });
    const conversation = await t.run((ctx) => ctx.db.get(c));
    expect(conversation?.lastMessage?.guid).toBe("m1");
  });
});

describe("replaceScheduled", () => {
  test("deletes rows missing from the snapshot", async () => {
    const t = convexTest(schema, modules);
    const item = { chatGuid: "iMessage;-;+15550001111", text: "hi", sendAt: 5, status: "pending" as const };
    await t.mutation(internal.comma.internal.replaceScheduled, { items: [{ bbId: 1, ...item }, { bbId: 2, ...item }] });
    const result = await t.mutation(internal.comma.internal.replaceScheduled, { items: [{ bbId: 2, ...item }] });
    expect(result).toEqual({ upserted: 1, deleted: 1 });
  });
});

describe("importOverlay", () => {
  test("scoped snapshots remove deleted triage rows and allow state to turn off", async () => {
    const t = convexTest(schema, modules);
    const chatGuid = "iMessage;-;+15550001111";
    const otherGuid = "iMessage;-;+15550002222";
    const id = await seedDm(t, "+15550001111", [{ chatGuid, lastMessageAt: 1 }]);
    await seedDm(t, "+15550002222", [{ chatGuid: otherGuid, lastMessageAt: 1 }]);
    const state = { chatGuid, pinned: true, markedUnread: true, mutedUnresponded: false, readAt: 10, dismissedUnrespondedGuid: "m1" };
    await t.mutation(internal.comma.internal.importOverlay, {
      chatState: [state],
      triageEvents: [chatGuid, otherGuid].map((guid) => ({ chatGuid: guid, messageGuid: "m1", reason: "dismiss" as const, clearedAt: 1 })),
      triageOpen: [chatGuid, otherGuid].map((guid) => ({ chatGuid: guid, messageGuid: "m1", openedAt: 1 })),
    });
    const args = { replaceChatGuids: [chatGuid],
      chatState: [{ chatGuid, pinned: false, markedUnread: false, mutedUnresponded: false, readAt: 20 }], triageEvents: [], triageOpen: [] };
    await t.mutation(internal.comma.internal.importOverlay, args);
    await t.mutation(internal.comma.internal.importOverlay, args);
    const actual = await t.run((ctx) => ctx.db.query("comma_conversation_state").withIndex("by_conversationId", (q) => q.eq("conversationId", id)).unique());
    expect(actual).toMatchObject({ pinned: false, markedUnread: false, readAt: 20 });
    expect(actual?.dismissedUnrespondedGuid).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("comma_triage_events").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("comma_triage_open").collect())).toHaveLength(1);
  });
  test("merges siblings so a pin survives a newer sibling, and re-import is idempotent", async () => {
    const t = convexTest(schema, modules);
    const c = await seedDm(t, "+15550001111", [
      { chatGuid: "iMessage;-;+15550001111", lastMessageAt: 2000 },
      { chatGuid: "SMS;-;+15550001111", lastMessageAt: 3000 },
    ]);
    const args = {
      chatState: [
        { chatGuid: "iMessage;-;+15550001111", pinned: true, markedUnread: false, mutedUnresponded: false, readAt: 10 },
        { chatGuid: "SMS;-;+15550001111", pinned: false, markedUnread: false, mutedUnresponded: false, readAt: 20 },
      ],
      triageEvents: [{ chatGuid: "SMS;-;+15550001111", messageGuid: "m9", reason: "reply" as const, clearedAt: 99 }],
      triageOpen: [],
    };
    await t.mutation(internal.comma.internal.importOverlay, args);
    const again = await t.mutation(internal.comma.internal.importOverlay, args);
    const state = await t.run((ctx) =>
      ctx.db.query("comma_conversation_state").withIndex("by_conversationId", (q) => q.eq("conversationId", c)).unique(),
    );
    const events = await t.run((ctx) => ctx.db.query("comma_triage_events").collect());
    expect(state?.pinned).toBe(true);
    expect(state?.readAt).toBe(20);
    expect(again.events).toBe(0);
    expect(events).toHaveLength(1);
  });
});

describe("setAttachmentStorage", () => {
  test("links either file without changing the row version or clearing the other file", async () => {
    const t = convexTest(schema, modules);
    const conversationId = await seedDm(t, "+15550001111", [{ chatGuid: "iMessage;-;+15550001111", lastMessageAt: 1 }]);
    const attachment = { guid: "photo", messageGuid: "m1", conversationId,
      isOnDisk: true, isSticker: false, hideAttachment: false, sourceVersion: 5, transcript: "hello" };
    await t.mutation(internal.comma.internal.upsertAttachments, { attachments: [attachment] });
    const thumbStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["thumb"], { type: "image/jpeg" })));
    const originalStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["original"], { type: "image/jpeg" })));
    expect(await t.mutation(internal.comma.internal.setAttachmentStorage, { guid: "missing", thumbStorageId })).toBe(false);
    for (let i = 0; i < 2; i++) {
      expect(await t.mutation(internal.comma.internal.setAttachmentStorage, { guid: "photo", thumbStorageId })).toBe(true);
    }
    await t.mutation(internal.comma.internal.setAttachmentStorage, { guid: "photo", originalStorageId });
    let row = await t.run((ctx) => ctx.db.query("comma_attachments").first());
    expect(row).toMatchObject({ thumbStorageId, originalStorageId, transcript: "hello", sourceVersion: 5 });
    await t.mutation(internal.comma.internal.upsertAttachments, { attachments: [{ ...attachment, sourceVersion: 6 }] });
    row = await t.run((ctx) => ctx.db.query("comma_attachments").first());
    expect(row).toMatchObject({ thumbStorageId, originalStorageId, sourceVersion: 6 });
  });
});

describe("mergeDuplicateConversations", () => {
  test("folds a re-keyed duplicate into the older conversation id", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const base = { primaryChatGuid: "SMS;-;900080006201", chatGuids: ["SMS;-;900080006201"], displayName: "x", isGroup: false, participants: [], isSpam: false, hasGroupPhoto: false, lastMessageAt: 5, updatedAt: 1 };
      const old = await ctx.db.insert("comma_conversations", { ...base, conversationKey: "dm:+900080006201" });
      const dup = await ctx.db.insert("comma_conversations", { ...base, conversationKey: "dm:900080006201" });
      await ctx.db.insert("comma_chat_aliases", { chatGuid: "SMS;-;900080006201", conversationId: dup, service: "SMS" });
      return { old, dup };
    });
    const merges = await t.mutation(internal.comma.internal.mergeDuplicateConversations, { dryRun: false });
    const rows = await t.run((ctx) => ctx.db.query("comma_conversations").collect());
    const alias = await t.run((ctx) => ctx.db.query("comma_chat_aliases").first());
    expect(merges).toEqual([{ kept: ids.old, removed: ids.dup, key: "dm:900080006201" }]);
    expect(rows.map((row) => [row._id, row.conversationKey])).toEqual([[ids.old, "dm:900080006201"]]);
    expect(alias?.conversationId).toBe(ids.old);
  });
});
