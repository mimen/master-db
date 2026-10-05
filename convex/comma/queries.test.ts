import { makeFunctionReference, type ApiFromModules } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";

import type { searchMessages } from "./queries";
import { commaModules } from "./testModules.vitest";

const paginationOpts = { numItems: 2, cursor: null };

function conversation(key: string, date: number): Omit<Doc<"comma_conversations">, "_id" | "_creationTime"> {
  return {
    conversationKey: `dm:${key}`,
    primaryChatGuid: `iMessage;-;${key}`,
    chatGuids: [`iMessage;-;${key}`],
    displayName: key,
    isGroup: false,
    participants: [{ address: key, name: null }],
    lastMessage: {
      guid: `last-${key}`,
      text: "Hello",
      dateCreated: date,
      isFromMe: false,
      senderName: key,
      hasAttachments: false,
    },
    lastMessageAt: date,
    isSpam: false,
    hasGroupPhoto: false,
    updatedAt: date,
  };
}

function message(conversationId: Id<"comma_conversations">, guid: string, date: number): Omit<Doc<"comma_messages">, "_id" | "_creationTime"> {
  return {
    conversationId,
    guid,
    chatGuid: "iMessage;-;one",
    dateCreated: date,
    isFromMe: false,
    text: "Hello comet",
    service: "iMessage",
    error: 0,
    edited: false,
    retracted: false,
    isTapback: false,
    reactions: [],
    isGroupEvent: false,
    mentions: [],
    attachmentGuids: [],
    sourceVersion: 1,
  };
}

function authed() {
  return convexTest(schema, commaModules).withIdentity({ email: ALLOWED_EMAIL });
}

describe("Comma read queries", () => {
  test("empty conversations do not consume sidebar page slots", async () => {
    const t = authed();
    await t.run(async (ctx) => {
      await ctx.db.insert("comma_conversations", { ...conversation("empty-newest", 100), lastMessage: undefined });
      await ctx.db.insert("comma_conversations", conversation("visible", 10));
      await ctx.db.insert("comma_conversations", { ...conversation("empty-oldest", 0), lastMessage: undefined });
    });
    const result = await t.query(api.comma.queries.listConversations, { paginationOpts });
    expect(result.page.map((row) => row.displayName)).toEqual(["visible"]);
    expect(result.isDone).toBe(true);
  });
  test("conversation queries reject unauthenticated callers", async () => {
    const t = convexTest(schema, commaModules);
    const id = await t.run((ctx) => ctx.db.insert("comma_conversations", conversation("one", 1)));
    await expect(t.query(api.comma.queries.listConversations, { paginationOpts })).rejects.toThrow("Unauthorized");
    await expect(t.query(api.comma.queries.getConversation, { conversationId: id })).rejects.toThrow("Unauthorized");
    await expect(t.query(api.comma.queries.resolveChat, { chatGuid: "one" })).rejects.toThrow("Unauthorized");
  });

  test("message queries reject unauthenticated callers", async () => {
    const t = convexTest(schema, commaModules);
    const id = await t.run((ctx) => ctx.db.insert("comma_conversations", conversation("one", 1)));
    await expect(t.query(api.comma.queries.listMessages, { conversationId: id, paginationOpts })).rejects.toThrow("Unauthorized");
    await expect(t.query(api.comma.queries.searchMessages, { query: "comet" })).rejects.toThrow("Unauthorized");
  });

  test("paginates visible messages newest first within one conversation", async () => {
    const t = authed();
    const id = await t.run(async (ctx) => {
      const id = await ctx.db.insert("comma_conversations", conversation("one", 1));
      const other = await ctx.db.insert("comma_conversations", conversation("other", 1));
      await ctx.db.insert("comma_messages", message(id, "oldest", 1));
      await ctx.db.insert("comma_messages", message(id, "middle", 2));
      await ctx.db.insert("comma_messages", { ...message(id, "retracted", 3), retracted: true });
      await ctx.db.insert("comma_messages", message(id, "newest", 4));
      await ctx.db.insert("comma_messages", { ...message(id, "tapback", 5), isTapback: true });
      await ctx.db.insert("comma_messages", message(other, "other-chat", 6));
      return id;
    });
    const first = await t.query(api.comma.queries.listMessages, { conversationId: id, paginationOpts });
    expect(first.page.map((row) => row.guid)).toEqual(["newest", "middle"]);
    expect(first.page.map((row) => row.attachments)).toEqual([[], []]);
    expect(first.isDone).toBe(false);
    const second = await t.query(api.comma.queries.listMessages, {
      conversationId: id,
      paginationOpts: { ...paginationOpts, cursor: first.continueCursor },
    });
    expect(second.page.map((row) => row.guid)).toEqual(["oldest"]);
    expect(second.isDone).toBe(true);
  });

  test("joins only the message's attachments and resolves stored URLs", async () => {
    const t = authed();
    const seeded = await t.run(async (ctx) => {
      const id = await ctx.db.insert("comma_conversations", conversation("one", 1));
      await ctx.db.insert("comma_messages", message(id, "photo-message", 1));
      const thumb = await ctx.storage.store(new Blob(["thumbnail"]));
      const original = await ctx.storage.store(new Blob(["original"]));
      const attachment = {
        conversationId: id,
        messageGuid: "photo-message",
        isSticker: false,
        hideAttachment: false,
        isOnDisk: true,
        sourceVersion: 1,
      };
      await ctx.db.insert("comma_attachments", { ...attachment, guid: "photo", filename: "photo.jpg", thumbStorageId: thumb, originalStorageId: original });
      await ctx.db.insert("comma_attachments", { ...attachment, guid: "not-uploaded" });
      await ctx.db.insert("comma_attachments", { ...attachment, guid: "unrelated", messageGuid: "other-message" });
      return { id, thumbUrl: await ctx.storage.getUrl(thumb), originalUrl: await ctx.storage.getUrl(original) };
    });
    const result = await t.query(api.comma.queries.listMessages, { conversationId: seeded.id, paginationOpts });
    expect(result.page[0].attachments.map((row) => row.guid)).toEqual(["photo", "not-uploaded"]);
    expect(seeded.thumbUrl).toBeTypeOf("string");
    expect(seeded.originalUrl).toBeTypeOf("string");
    expect(result.page[0].attachments[0]).toMatchObject({ filename: "photo.jpg", thumbUrl: seeded.thumbUrl, originalUrl: seeded.originalUrl });
    expect(result.page[0].attachments[1]).toMatchObject({ thumbUrl: null, originalUrl: null });
  });

  test("search excludes tapbacks and tombstones and supports a conversation filter", async () => {
    const t = authed();
    const id = await t.run(async (ctx) => {
      const id = await ctx.db.insert("comma_conversations", conversation("one", 1));
      const other = await ctx.db.insert("comma_conversations", conversation("other", 1));
      await ctx.db.insert("comma_messages", message(id, "match", 1));
      await ctx.db.insert("comma_messages", message(other, "other-match", 2));
      await ctx.db.insert("comma_messages", { ...message(id, "reaction", 3), isTapback: true });
      await ctx.db.insert("comma_messages", { ...message(id, "tombstone", 4), retracted: true });
      await ctx.db.insert("comma_messages", { ...message(id, "unmatched", 5), text: "Goodbye" });
      return id;
    });
    const global = await t.query(api.comma.queries.searchMessages, { query: "comet" });
    expect(global.map((row) => row.guid).sort()).toEqual(["match", "other-match"]);
    const scoped = await t.query(api.comma.queries.searchMessages, { query: "comet", conversationId: id });
    expect(scoped.map((row) => row.guid)).toEqual(["match"]);
    expect(await t.query(api.comma.queries.searchMessages, { query: "missing" })).toEqual([]);
  });

  test("sender search filters inside the full-text index before the limit", async () => {
    // Depends on isFromMe landing in search_text.filterFields on the sibling schema branch.
    const searchRef = makeFunctionReference("comma/queries:searchMessages") as ApiFromModules<{
      queries: { searchMessages: typeof searchMessages };
    }>["queries"]["searchMessages"];
    const t = authed();
    const id = await t.run(async (ctx) => {
      const id = await ctx.db.insert("comma_conversations", conversation("one", 1));
      for (let i = 0; i < 55; i++) await ctx.db.insert("comma_messages", message(id, "inbound-" + i, i));
      await ctx.db.insert("comma_messages", { ...message(id, "outgoing", 60), isFromMe: true });
      await ctx.db.insert("comma_messages", { ...message(id, "outgoing-tombstone", 61), isFromMe: true, retracted: true });
      return id;
    });
    expect((await t.query(searchRef, { query: "comet", conversationId: id, from: "me" })).map((row) => row.guid)).toEqual(["outgoing"]);
    const inbound = await t.query(searchRef, { query: "comet", from: "them" });
    expect(inbound).toHaveLength(50);
    expect(inbound.every((row) => !row.isFromMe)).toBe(true);
  });

  test("draft, scheduled and sync queries reject unauthenticated callers", async () => {
    const t = convexTest(schema, commaModules);
    const id = await t.run((ctx) => ctx.db.insert("comma_conversations", conversation("one", 1)));
    await expect(t.query(api.comma.queries.getDraft, { conversationId: id })).rejects.toThrow("Unauthorized");
    await expect(t.query(api.comma.queries.listScheduled, {})).rejects.toThrow("Unauthorized");
    await expect(t.query(api.comma.queries.syncStatus, {})).rejects.toThrow("Unauthorized");
  });

  test("gets only the requested conversation's draft or null", async () => {
    const t = authed();
    const seeded = await t.run(async (ctx) => {
      const id = await ctx.db.insert("comma_conversations", conversation("one", 1));
      const other = await ctx.db.insert("comma_conversations", conversation("other", 1));
      const draftId = await ctx.db.insert("comma_drafts", { conversationId: id, text: "See you soon", updatedAt: 7 });
      return { id, other, draftId };
    });
    expect(await t.query(api.comma.queries.getDraft, { conversationId: seeded.id })).toMatchObject({
      _id: seeded.draftId, conversationId: seeded.id, text: "See you soon", updatedAt: 7,
    });
    expect(await t.query(api.comma.queries.getDraft, { conversationId: seeded.other })).toBeNull();
  });

  test("lists scheduled mirror rows in send order including terminal statuses", async () => {
    const t = authed();
    expect(await t.query(api.comma.queries.listScheduled, {})).toEqual([]);
    await t.run(async (ctx) => {
      await ctx.db.insert("comma_scheduled", { bbId: 2, chatGuid: "SMS;-;one", text: "Later", sendAt: 20, status: "pending", updatedAt: 1 });
      await ctx.db.insert("comma_scheduled", { bbId: 1, chatGuid: "SMS;-;one", text: "Earlier", sendAt: 10, status: "complete", sentAt: 10, updatedAt: 1 });
    });
    const rows = await t.query(api.comma.queries.listScheduled, {});
    expect(rows.map((row) => ({ bbId: row.bbId, text: row.text, sendAt: row.sendAt, status: row.status }))).toEqual([
      { bbId: 1, text: "Earlier", sendAt: 10, status: "complete" },
      { bbId: 2, text: "Later", sendAt: 20, status: "pending" },
    ]);
  });

  test("reads sync checkpoints without dropping optional health fields", async () => {
    const t = authed();
    expect(await t.query(api.comma.queries.syncStatus, {})).toEqual([]);
    await t.run(async (ctx) => {
      await ctx.db.insert("comma_sync_state", { key: "reconcile", lastReconcileAt: 9, counts: { messages: 42 }, updatedAt: 9 });
      await ctx.db.insert("comma_sync_state", { key: "events", cursor: "cursor-7", lastEventAt: 7, updatedAt: 7 });
    });
    const rows = await t.query(api.comma.queries.syncStatus, {});
    expect(rows.map((row) => row.key)).toEqual(["events", "reconcile"]);
    expect(rows[0]).toMatchObject({ key: "events", cursor: "cursor-7", lastEventAt: 7, updatedAt: 7 });
    expect(rows[1]).toMatchObject({ key: "reconcile", lastReconcileAt: 9, counts: { messages: 42 }, updatedAt: 9 });
  });

  test("a conversation with no messages has no triage flags", async () => {
    const t = authed();
    const id = await t.run((ctx) => {
      const row = conversation("empty", 0);
      delete row.lastMessage;
      return ctx.db.insert("comma_conversations", row);
    });
    expect((await t.query(api.comma.queries.getConversation, { conversationId: id }))?.flags).toEqual({
      unresponded: false, waiting: false, unread: false, mutedUnresponded: false, pinned: false,
    });
  });

  test("resolves an allowed user from the JWT subject", async () => {
    const t = convexTest(schema, commaModules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
    const result = await t.withIdentity({ subject: `${userId}|session` }).query(api.comma.queries.listConversations, { paginationOpts });
    expect(result.page).toEqual([]);
  });

  test("rejects a signed-in user outside the allowlist", async () => {
    const t = convexTest(schema, commaModules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: "other@example.com" }));
    await expect(t.withIdentity({ subject: `${userId}|session`, email: "other@example.com" })
      .query(api.comma.queries.listConversations, { paginationOpts })).rejects.toThrow("Unauthorized");
  });

  test("paginates conversations newest first and applies overlay flags", async () => {
    const t = authed();
    await t.run(async (ctx) => {
      await ctx.db.insert("comma_conversations", conversation("oldest", 1));
      const dismissed = await ctx.db.insert("comma_conversations", conversation("dismissed", 2));
      const pinned = await ctx.db.insert("comma_conversations", conversation("pinned", 3));
      await ctx.db.insert("comma_conversation_state", {
        conversationId: dismissed,
        dismissedUnrespondedGuid: "last-dismissed",
        mutedUnresponded: false,
        markedUnread: false,
        pinned: false,
        readAt: 0,
        updatedAt: 2,
      });
      await ctx.db.insert("comma_conversation_state", {
        conversationId: pinned,
        mutedUnresponded: true,
        markedUnread: true,
        pinned: true,
        readAt: 0,
        updatedAt: 3,
      });
    });
    const first = await t.query(api.comma.queries.listConversations, { paginationOpts });
    expect(first.page.map((row) => row.displayName)).toEqual(["pinned", "dismissed"]);
    expect(first.isDone).toBe(false);
    expect(first.page[0].flags).toEqual({ unresponded: true, waiting: false, unread: true, mutedUnresponded: false, pinned: true });
    expect(first.page[1].flags).toEqual({ unresponded: false, waiting: false, unread: false, mutedUnresponded: false, pinned: false });
    expect(first.page.map((row) => row.unreadCount)).toEqual([0, 0]);
    const second = await t.query(api.comma.queries.listConversations, {
      paginationOpts: { ...paginationOpts, cursor: first.continueCursor },
    });
    expect(second.page.map((row) => row.displayName)).toEqual(["oldest"]);
    expect(second.isDone).toBe(true);
  });

  test("unread comes from the mirrored count until Comma marks the conversation read", async () => {
    const t = authed();
    const [unread, read] = await t.run(async (ctx) => {
      const unread = await ctx.db.insert("comma_conversations", { ...conversation("unread", 20), unread: { count: 3, firstAt: 15 } });
      const read = await ctx.db.insert("comma_conversations", { ...conversation("read", 10), unread: { count: 2, firstAt: 5 } });
      await ctx.db.insert("comma_conversation_state", { conversationId: read, mutedUnresponded: false, markedUnread: false, pinned: false, readAt: 10, updatedAt: 10 });
      return [unread, read];
    });
    const { page } = await t.query(api.comma.queries.listConversations, { paginationOpts });
    expect(page.map((row) => [row._id, row.unreadCount, row.flags.unread])).toEqual([[unread, 3, true], [read, 0, false]]);
  });

  test("waiting dismissal expires when the last message changes", async () => {
    const t = authed();
    const id = await t.run(async (ctx) => {
      const row = conversation("outbound", 1);
      row.lastMessage = { ...row.lastMessage!, isFromMe: true };
      const id = await ctx.db.insert("comma_conversations", row);
      await ctx.db.insert("comma_conversation_state", {
        conversationId: id,
        dismissedWaitingGuid: "last-outbound",
        mutedUnresponded: false,
        markedUnread: false,
        pinned: false,
        readAt: 0,
        updatedAt: 1,
      });
      return id;
    });
    expect((await t.query(api.comma.queries.getConversation, { conversationId: id }))?.flags.waiting).toBe(false);
    await t.run((ctx) => ctx.db.patch(id, { lastMessage: { guid: "new-outbound", text: "Again", dateCreated: 2, isFromMe: true, senderName: null, hasAttachments: false } }));
    expect((await t.query(api.comma.queries.getConversation, { conversationId: id }))?.flags.waiting).toBe(true);
  });

  test("resolves a sibling chat GUID through its alias", async () => {
    const t = authed();
    const id = await t.run(async (ctx) => {
      const id = await ctx.db.insert("comma_conversations", conversation("one", 1));
      await ctx.db.insert("comma_chat_aliases", { chatGuid: "SMS;-;one", conversationId: id, service: "SMS" });
      return id;
    });
    const resolved = await t.query(api.comma.queries.resolveChat, { chatGuid: "SMS;-;one" });
    expect(resolved?._id).toBe(id);
    expect(resolved).toEqual(await t.query(api.comma.queries.getConversation, { conversationId: id }));
    expect(await t.query(api.comma.queries.resolveChat, { chatGuid: "missing" })).toBeNull();
    await t.run((ctx) => ctx.db.delete(id));
    expect(await t.query(api.comma.queries.getConversation, { conversationId: id })).toBeNull();
    expect(await t.query(api.comma.queries.resolveChat, { chatGuid: "SMS;-;one" })).toBeNull();
  });

  test("carries the CRM a DM inherits from its person and a group owns", async () => {
    const t = authed();
    const [dm, group, plain] = await t.run(async (ctx) => {
      const address = "+16195551234";
      const personId = await ctx.db.insert("people", {
        display_name: "Tracy", normalized_phones: [address], normalized_emails: [], is_favorite: true, priority: 2,
        identity_count: 1, message_count: 0, is_self: false, auto_clustered: true, created_at: "x", updated_at: "x",
      });
      await ctx.db.insert("identities", { kind: "phone", value: address, normalized: address, person_id: personId,
        message_count: 0, chat_count: 0, is_self: false, source: "apple_contact", created_at: "x", updated_at: "x" });
      await ctx.db.insert("tags", { person_id: personId, tag: "showcase", created_at: "x" });
      await ctx.db.insert("chat_crm", { chat_guid: "iMessage;+;crew", priority: 4, created_at: "x", updated_at: "x" });
      await ctx.db.insert("tags", { chat_guid: "iMessage;+;crew", tag: "launch", created_at: "x" });
      const dm = await ctx.db.insert("comma_conversations", { ...conversation("dm", 3), participants: [{ address, name: null }] });
      const group = await ctx.db.insert("comma_conversations", { ...conversation("crew", 2), isGroup: true, primaryChatGuid: "iMessage;+;crew" });
      const plain = await ctx.db.insert("comma_conversations", conversation("plain", 1));
      return [dm, group, plain];
    });
    const crm = async (conversationId: Id<"comma_conversations">) =>
      (await t.query(api.comma.queries.getConversation, { conversationId }))?.crm;
    expect(await crm(dm)).toEqual({ is_favorite: true, priority: 2, tags: ["showcase"] });
    expect(await crm(group)).toEqual({ priority: 4, tags: ["launch"] });
    expect(await crm(plain)).toBeUndefined();
  });
});

test("suggestions require the allowed identity and return only the requested conversation", async () => {
  const t = convexTest(schema, commaModules);
  const id = await t.run((ctx) => ctx.db.insert("comma_conversations", conversation("suggestions", 1)));
  await expect(t.query(api.comma.queries.getSuggestions, { conversationId: id })).rejects.toThrow("Unauthorized");
  await expect(t.withIdentity({ email: "other@example.com" }).query(api.comma.queries.getSuggestions, { conversationId: id })).rejects.toThrow("Unauthorized");
  const allowed = t.withIdentity({ email: ALLOWED_EMAIL });
  expect(await allowed.query(api.comma.queries.getSuggestions, { conversationId: id })).toBeNull();
  const payload = { suggestions: [], event: null, recipeVersion: 1, selectedModel: "opus" as const,
    servedModel: "opus" as const, fallback: false, noReply: true };
  await t.run((ctx) => ctx.db.insert("comma_suggestions", { conversationId: id, anchorGuid: "latest", payload, createdAt: 42 }));
  expect(await allowed.query(api.comma.queries.getSuggestions, { conversationId: id })).toMatchObject({ anchorGuid: "latest", payload, createdAt: 42 });
  const other = await t.run((ctx) => ctx.db.insert("comma_conversations", conversation("other", 2)));
  expect(await allowed.query(api.comma.queries.getSuggestions, { conversationId: other })).toBeNull();
});

test("conversation and message names react to identity changes without a bridge refresh", async () => {
  const t = authed();
  const { personId, conversationId } = await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      display_name: "Name Before", normalized_phones: ["+16195551234"], normalized_emails: [],
      identity_count: 1, message_count: 0, is_self: false, auto_clustered: false,
      created_at: "before", updated_at: "before",
    });
    await ctx.db.insert("identities", { person_id: personId, kind: "phone", source: "manual", value: "+16195551234", normalized: "+16195551234",
      is_self: false, message_count: 0, chat_count: 0, created_at: "before", updated_at: "before" });
    const conversationId = await ctx.db.insert("comma_conversations", conversation("+16195551234", 1));
    await ctx.db.insert("comma_messages", { ...message(conversationId, "m", 1), sender: { address: "+16195551234 (smsfp)", name: "Old mirrored name" } });
    return { personId, conversationId };
  });
  await t.run((ctx) => ctx.db.patch(personId, { display_name: "Name After" }));
  const view = await t.query(api.comma.queries.getConversation, { conversationId });
  expect(view).toMatchObject({ displayName: "Name After", participants: [{ name: "Name After" }], lastMessage: { senderName: "Name After" } });
  const messages = await t.query(api.comma.queries.listMessages, { conversationId, paginationOpts });
  expect(messages.page[0].sender?.name).toBe("Name After");
});
