import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

import { messageKey } from "./reactions";
import { IMESSAGE_ACCOUNT } from "./conversationIdentity";
import { ensureAccount } from "./accounts";
import { commaModules } from "./testModules.vitest";

const modules = { ...commaModules, "../../comma/agentContext.ts": () => import("./agentContext") };
const ALEX = "+15550001111";
const SAM = "sam@example.com";

function message(conversationId: Id<"comma_conversations">, guid: string, dateCreated: number, fields: Partial<Doc<"comma_messages">> = {}) {
  return {
    guid, conversationId, chatGuid: "chat", dateCreated, isFromMe: false, text: guid, service: "iMessage" as const, error: 0,
    edited: false, retracted: false, isTapback: false, reactions: [], isGroupEvent: false, mentions: [], attachmentGuids: [],
    sourceVersion: 0, sender: { address: ALEX, name: null }, ...fields,
  };
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date(0).toISOString();
    const personId = await ctx.db.insert("people", {
      display_name: "Alex Rivera", normalized_phones: [ALEX, "+15559990000"], normalized_emails: ["alex@example.com"],
      notes: "Runs the door", is_favorite: true, priority: 2, organization: "AUF", created_at: now, updated_at: now,
      identity_count: 1, message_count: 0, is_self: false, auto_clustered: false,
    });
    await ctx.db.insert("identities", {
      person_id: personId, kind: "phone", value: ALEX, normalized: ALEX, message_count: 0, chat_count: 0, is_self: false,
      source: "participant", created_at: now, updated_at: now,
    });
    await ctx.db.insert("tags", { person_id: personId, tag: "door", created_at: now });
    await ctx.db.insert("event_links", { person_id: personId, airtable_event_id: "rec1", event_name: "Sunset", created_at: now });
    const conversationId = await ctx.db.insert("comma_conversations", {
      conversationKey: "group", primaryChatGuid: "chat", chatGuids: ["chat"], displayName: "Door crew", isGroup: true,
      participants: [{ address: ALEX, name: "alex?" }, { address: SAM, name: null }],
      lastMessageAt: 1, isSpam: false, hasGroupPhoto: false, updatedAt: 1,
    });
    const storageId = await ctx.storage.store(new Blob(["png"], { type: "image/png" }));
    await ctx.db.insert("comma_attachments", {
      guid: "att1", conversationId, messageGuid: "m2", isSticker: false, hideAttachment: false, isOnDisk: true, sourceVersion: 1,
      originalStorageId: storageId, mimeType: "image/png", transferName: "door.png",
    });
    await ctx.db.insert("comma_messages", message(conversationId, "m1", 10, { text: "the door code is 4411" }));
    await ctx.db.insert("comma_messages", message(conversationId, "m2", 20, { attachmentGuids: ["att1"], sender: { address: SAM, name: null } }));
    await ctx.db.insert("comma_messages", message(conversationId, "tapback", 25, { isTapback: true }));
    await ctx.db.insert("comma_messages", message(conversationId, "m3", 30, { isFromMe: true, sender: undefined }));
    await ctx.db.insert("comma_messages", message(conversationId, "m4", 40));
    await ctx.db.insert("comma_reactions", {
      platform: "imessage", conversationId, targetKey: messageKey("imessage", (await ensureAccount(ctx, IMESSAGE_ACCOUNT))._id, "m2"), key: "like", emoji: "👍", isFromMe: false, senderAddress: ALEX, at: 21, removed: false,
    });
    await ctx.db.insert("comma_reactions", {
      platform: "imessage", conversationId, targetKey: messageKey("imessage", (await ensureAccount(ctx, IMESSAGE_ACCOUNT))._id, "m2"), key: "laugh", emoji: "😂", isFromMe: true, at: 22, removed: true,
    });
    return { conversationId, personId };
  });
  return { t, ...ids };
}

describe("agentContext", () => {
  test("returns the newest messages newest-last with contact names and attachments", async () => {
    const { t, conversationId } = await setup();
    const context = await t.mutation(internal.comma.agentContext.agentContext, { conversationId, limit: 3 });
    expect(context.title).toBe("Door crew");
    expect(context.participants).toEqual([
      { name: "Alex Rivera", handles: [ALEX, "+15559990000", "alex@example.com"] },
      { name: SAM, handles: [SAM] },
    ]);
    expect(context.messages).toEqual([
      { guid: "m2", at: 20, fromMe: false, sender: SAM, text: "m2", attachments: [{ guid: "att1", name: "door.png", mime: "image/png" }],
        reactions: [{ reaction: "👍", fromMe: false, sender: "Alex Rivera" }] },
      { guid: "m3", at: 30, fromMe: true, sender: "Me", text: "m3", attachments: [], reactions: [] },
      { guid: "m4", at: 40, fromMe: false, sender: "Alex Rivera", text: "m4", attachments: [], reactions: [] },
    ]);
  });

  test("bounds are exclusive on both sides", async () => {
    const { t, conversationId } = await setup();
    const guids = async (bounds: { sinceMessageAt?: number; beforeMessageAt?: number }) =>
      (await t.mutation(internal.comma.agentContext.agentContext, { conversationId, limit: 40, ...bounds })).messages.map(({ guid }) => guid);
    expect(await guids({ sinceMessageAt: 20 })).toEqual(["m3", "m4"]);
    expect(await guids({ beforeMessageAt: 30 })).toEqual(["m1", "m2"]);
    expect(await guids({ sinceMessageAt: 10, beforeMessageAt: 40 })).toEqual(["m2", "m3"]);
    await expect(t.mutation(internal.comma.agentContext.agentContext, { conversationId, limit: 0 })).rejects.toThrow("limit");
  });
});

test("agentSearch finds thread messages in the agent's message shape", async () => {
  const { t, conversationId } = await setup();
  expect(await t.mutation(internal.comma.agentContext.agentSearch, { conversationId, query: "code" })).toEqual([
    { guid: "m1", at: 10, fromMe: false, sender: "Alex Rivera", text: "the door code is 4411", attachments: [], reactions: [] },
  ]);
});

test("agentPeople returns each participant with their CRM fields", async () => {
  const { t, conversationId, personId } = await setup();
  expect(await t.mutation(internal.comma.agentContext.agentPeople, { conversationId })).toEqual([
    {
      address: ALEX, name: "Alex Rivera", handles: [ALEX, "+15559990000", "alex@example.com"], personId,
      notes: "Runs the door", is_favorite: true, priority: 2, organization: "AUF", tags: ["door"],
      events: [{ airtable_event_id: "rec1", event_name: "Sunset" }],
    },
    { address: SAM, name: SAM, handles: [SAM], tags: [], events: [] },
  ]);
});

test("agentAttachment returns a storage URL with the file's name and type", async () => {
  const { t, conversationId } = await setup();
  expect(await t.mutation(internal.comma.agentContext.agentAttachment, { conversationId, guid: "att1" })).toEqual({
    url: expect.stringMatching(/^https?:/), name: "door.png", mime: "image/png",
  });
  expect(await t.mutation(internal.comma.agentContext.agentAttachment, { conversationId, guid: "nope" })).toBeNull();
});

test("agentAttachment returns null for another conversation's attachment", async () => {
  const { t, conversationId } = await setup();
  const otherId = await t.run(async (ctx) => {
    const otherId = await ctx.db.insert("comma_conversations", {
      conversationKey: "dm", primaryChatGuid: "other", chatGuids: ["other"], displayName: "Sam", isGroup: false,
      participants: [{ address: SAM, name: null }], lastMessageAt: 1, isSpam: false, hasGroupPhoto: false, updatedAt: 1,
    });
    const storageId = await ctx.storage.store(new Blob(["pdf"], { type: "application/pdf" }));
    // The attachment row claims this conversation; its message says otherwise, and the message wins.
    await ctx.db.insert("comma_attachments", {
      guid: "private", conversationId, messageGuid: "o1", isSticker: false, hideAttachment: false, isOnDisk: true, sourceVersion: 1,
      originalStorageId: storageId, mimeType: "application/pdf", transferName: "lease.pdf",
    });
    await ctx.db.insert("comma_messages", message(otherId, "o1", 50, { attachmentGuids: ["private"], sender: { address: SAM, name: null } }));
    return otherId;
  });
  expect(await t.mutation(internal.comma.agentContext.agentAttachment, { conversationId, guid: "private" })).toBeNull();
  expect(await t.mutation(internal.comma.agentContext.agentAttachment, { conversationId: otherId, guid: "att1" })).toBeNull();
  expect(await t.mutation(internal.comma.agentContext.agentAttachment, { conversationId: otherId, guid: "private" })).toMatchObject({ name: "lease.pdf" });
});

describe("aiThread", () => {
  test("reads the thread as wire messages, newest last, with contact names, reactions and attachment kinds", async () => {
    const { t, conversationId } = await setup();
    await t.run(async (ctx) => ctx.db.insert("comma_reactions", { platform: "imessage", conversationId, targetKey: messageKey("imessage", (await ensureAccount(ctx, IMESSAGE_ACCOUNT))._id, "m4"), key: "love", emoji: "❤️",
      isFromMe: true, at: 1, removed: false }));
    const thread = await t.mutation(internal.comma.agentContext.aiThread, { conversationId });
    expect(thread).toMatchObject({ title: "Door crew", isGroup: true,
      participants: [{ address: ALEX, name: "Alex Rivera", emails: ["alex@example.com"] }, { address: SAM, name: null, emails: [] }],
      bridge: { privateApi: false, emojiReactions: false } });
    expect(thread.messages.map((m) => m.guid)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(thread.messages[0]).toMatchObject({ sender: { address: ALEX, name: "Alex Rivera" }, text: "the door code is 4411", reactions: [] });
    expect(thread.messages[1]?.attachments).toEqual([{ guid: "att1", mimeType: "image/png", filename: "door.png", width: null, height: null, totalBytes: null }]);
    expect(thread.messages[2]).toMatchObject({ isFromMe: true, sender: null });
    expect(thread.messages[3]?.reactions).toEqual([{ key: "love", emoji: "❤️", isFromMe: true, senderName: null, senderAddress: null, type: "love" }]);
    expect(thread.messages[1]?.reactions).toEqual([
      { key: "like", emoji: "👍", isFromMe: false, senderName: "Alex Rivera", senderAddress: ALEX, type: "like" },
    ]);
  });

  test("returns the route a reply takes, and each message's model text where an adapter derived one", async () => {
    const { t, conversationId } = await setup();
    await t.run(async (ctx) => {
      const row = await ctx.db.query("comma_messages").withIndex("by_conversation_date", (q) => q.eq("conversationId", conversationId).eq("dateCreated", 40)).unique();
      await ctx.db.patch(row!._id, { modelText: "doors at 9 works", subject: "Friday", threadRef: "lineup" });
    });
    const thread = await t.mutation(internal.comma.agentContext.aiThread, { conversationId });
    expect(thread.route).toEqual({ platform: "imessage", chatGuid: "chat" });
    expect(thread.messages[3]).toMatchObject({ text: "m4", modelText: "doors at 9 works", subject: "Friday", threadRef: "lineup" });
    expect(Object.keys(thread.messages[0]!)).not.toContain("modelText");
  });

  test("carries what the route's Mac reports it can send, so the AI process never asks BlueBubbles", async () => {
    const { t, conversationId } = await setup();
    await t.run((ctx) => ctx.db.insert("comma_bridge_state", { key: "imessage:acct", connected: true, lastSeenAt: 1,
      capabilities: { executor: "imessage", privateApi: true, emojiReactions: false } }));
    expect((await t.mutation(internal.comma.agentContext.aiThread, { conversationId })).bridge).toEqual({ privateApi: true, emojiReactions: false });
  });
});

test("the agent's view carries model text, the replied-to preview and a placeholder for a body-less payload", async () => {
  const { t, conversationId } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("comma_messages", message(conversationId, "m5", 50, { text: "raw > quoted", modelText: "raw", replyToPreview: "door code?" }));
    await ctx.db.insert("comma_messages", message(conversationId, "m6", 60, { text: "", special: { kind: "location" } }));
  });
  const context = await t.mutation(internal.comma.agentContext.agentContext, { conversationId, limit: 2 });
  expect(context.messages).toEqual([
    { guid: "m5", at: 50, fromMe: false, sender: "Alex Rivera", text: "raw > quoted", modelText: "raw", replyTo: "door code?", attachments: [], reactions: [] },
    { guid: "m6", at: 60, fromMe: false, sender: "Alex Rivera", text: "", placeholder: "[location]", attachments: [], reactions: [] },
  ]);
});

test("aiSentText reads the account's own sent texts newest first, counting rows from before accounts as its own", async () => {
  const { t, conversationId } = await setup();
  const accountId = await t.run(async (ctx) => {
    const account = (externalId: string) => ctx.db.insert("comma_accounts", {
      platform: "imessage", externalId, label: externalId, selfHandles: [], health: "ok", createdAt: 0,
    });
    // setup's reactions already made the iMessage account.
    const mine = (await ensureAccount(ctx, IMESSAGE_ACCOUNT))._id;
    const other = await account("other-mac");
    const sent = (guid: string, at: number, fields: Partial<Doc<"comma_messages">>) =>
      ctx.db.insert("comma_messages", message(conversationId, guid, at, { isFromMe: true, sender: undefined, ...fields }));
    await sent("s1", 100, { platform: "imessage", accountId: mine, text: "on it, doors at 9" });
    await sent("s2", 90, { platform: "imessage", accountId: mine, text: "> quoted", modelText: "see you there" });
    await sent("s3", 80, { platform: "imessage", text: "stamped before accounts" });
    await sent("s4", 300, { platform: "imessage", accountId: other, text: "another account's" });
    await sent("s5", 110, { platform: "imessage", accountId: mine, text: "unsent", retracted: true });
    await sent("s6", 120, { platform: "imessage", accountId: mine, text: "still queued", sendState: "queued" });
    await sent("s7", 130, { platform: "imessage", accountId: mine, text: "k" });
    return mine;
  });
  expect(await t.mutation(internal.comma.agentContext.aiSentText, { platform: "imessage", accountId }))
    .toEqual(["on it, doors at 9", "see you there", "stamped before accounts", "m3"]);
  await t.run(async (ctx) => {
    const other = await ctx.db.query("comma_accounts").withIndex("by_platform_externalId", (q) => q.eq("platform", "imessage").eq("externalId", "other-mac")).unique();
    await ctx.db.delete(other!._id);
  });
  expect(await t.mutation(internal.comma.agentContext.aiSentText, { platform: "imessage" }), "a route without an account reads the only one's")
    .toEqual(["on it, doors at 9", "see you there", "stamped before accounts", "m3"]);
});
