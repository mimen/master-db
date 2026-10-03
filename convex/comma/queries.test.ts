import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";

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

function authed() {
  return convexTest(schema, commaModules).withIdentity({ email: ALLOWED_EMAIL });
}

describe("Comma read queries", () => {
  test("conversation queries reject unauthenticated callers", async () => {
    const t = convexTest(schema, commaModules);
    const id = await t.run((ctx) => ctx.db.insert("comma_conversations", conversation("one", 1)));
    await expect(t.query(api.comma.queries.listConversations, { paginationOpts })).rejects.toThrow("Unauthorized");
    await expect(t.query(api.comma.queries.getConversation, { conversationId: id })).rejects.toThrow("Unauthorized");
    await expect(t.query(api.comma.queries.resolveChat, { chatGuid: "one" })).rejects.toThrow("Unauthorized");
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
});
