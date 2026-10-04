import { makeFunctionReference, type FunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { internal } from "../_generated/api";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
type Page = { done: boolean; phase?: "messages" | "attachments" | "scheduled" | "suggestions" | "events" | "open" | "state" | "drafts" | "presence" | "finalize"; cursor?: string };
const deletion = makeFunctionReference<"mutation", { chatGuid: string; phase?: Page["phase"]; cursor?: string }, Page>("comma/deletions:deleteChat") as unknown as FunctionReference<"mutation", "internal", { chatGuid: string; phase?: Page["phase"]; cursor?: string }, Page>;
async function removeChat(t: TestConvex<typeof schema>, chatGuid: string) {
  let page: Page = { done: false };
  while (!page.done) page = await t.mutation(deletion, { chatGuid, ...(page.phase ? { phase: page.phase } : {}), ...(page.cursor ? { cursor: page.cursor } : {}) });
}
const CHAT = "iMessage;-;+15550001111";
const SIBLING = "SMS;-;+15550001111";
const snapshot = (chats = [CHAT, SIBLING]) => ({
  conversationKey: "dm:+15550001111",
  chats: chats.map((chatGuid) => ({ chatGuid, lastMessageAt: chatGuid === CHAT ? 2000 : 1000 })),
  displayName: "Alex", isGroup: false, participants: [{ address: "+15550001111", name: null }],
  isSpam: false, hasGroupPhoto: false, lastMessageAt: chats.includes(CHAT) ? 2000 : 1000,
});
async function seed(chats = [CHAT, SIBLING]) {
  const t = convexTest(schema, modules);
  const ids = await t.mutation(internal.comma.internal.upsertConversations, { conversations: [snapshot(chats)] });
  const conversationId = ids[chats[0]!]!;
  const messages = chats.map((chatGuid) => ({ guid: chatGuid === CHAT ? "deleted-message" : "surviving-message", conversationId,
    chatGuid, dateCreated: chatGuid === CHAT ? 2000 : 1000, isFromMe: false, text: chatGuid,
    service: chatGuid === CHAT ? "iMessage" as const : "SMS" as const, error: 0, edited: false, retracted: false,
    isTapback: false, reactions: [], isGroupEvent: false, mentions: [], attachmentGuids: [chatGuid], sourceVersion: 1 }));
  await t.mutation(internal.comma.internal.upsertMessages, { messages });
  await t.mutation(internal.comma.internal.upsertAttachments, { attachments: messages.map((message) => ({
    guid: message.chatGuid, messageGuid: message.guid, conversationId, isSticker: false, hideAttachment: false,
    isOnDisk: true, sourceVersion: 1,
  })) });
  await t.run(async (ctx) => {
    await ctx.db.insert("comma_conversation_state", { conversationId, pinned: true, markedUnread: true, mutedUnresponded: false,
      readAt: 0, updatedAt: 1, dismissedUnrespondedGuid: "deleted-message" });
    await ctx.db.insert("comma_drafts", { conversationId, text: "draft", updatedAt: 1 });
    await ctx.db.insert("comma_presence", { conversationId, peerTyping: true, updatedAt: 1, expiresAt: 2 });
    await ctx.db.insert("comma_triage_open", { conversationId, messageGuid: "deleted-message", openedAt: 1 });
    await ctx.db.insert("comma_triage_events", { conversationId, messageGuid: "deleted-message", clearedAt: 2, reason: "reply" });
    await ctx.db.insert("comma_suggestions", { conversationId, anchorGuid: "deleted-message", createdAt: 1,
      payload: { suggestions: [], event: null, recipeVersion: 1, selectedModel: "opus", servedModel: "opus", fallback: false, noReply: false } });
    for (const chatGuid of chats) await ctx.db.insert("comma_scheduled", { bbId: chatGuid === CHAT ? 1 : 2,
      conversationId, chatGuid, text: "scheduled", sendAt: 10000, status: "pending", updatedAt: 1 });
  });
  return { t, conversationId };
}

test("delete one service alias, preserve siblings and their state, and reconcile without resurrection", async () => {
  const { t, conversationId } = await seed();
  await removeChat(t, CHAT);
  await removeChat(t, CHAT);
  const read = () => t.run(async (ctx) => ({ conversation: await ctx.db.get(conversationId),
    aliases: await ctx.db.query("comma_chat_aliases").collect(), messages: await ctx.db.query("comma_messages").collect(),
    attachments: await ctx.db.query("comma_attachments").collect(), state: await ctx.db.query("comma_conversation_state").unique(),
    drafts: await ctx.db.query("comma_drafts").collect(), scheduled: await ctx.db.query("comma_scheduled").collect(),
    suggestions: await ctx.db.query("comma_suggestions").collect(), triage: await ctx.db.query("comma_triage_open").collect(),
  }));
  const rows = await read();
  expect(rows.conversation).toMatchObject({ primaryChatGuid: SIBLING, chatGuids: [SIBLING], lastMessageAt: 1000, lastMessage: { guid: "surviving-message" } });
  expect(rows.aliases.map((row) => row.chatGuid)).toEqual([SIBLING]);
  expect(rows.messages.map((row) => row.guid)).toEqual(["surviving-message"]);
  expect(rows.attachments.map((row) => row.guid)).toEqual([SIBLING]);
  expect(rows.state).toMatchObject({ pinned: true, markedUnread: true });
  expect(rows.state?.dismissedUnrespondedGuid).toBeUndefined();
  expect(rows.drafts).toHaveLength(1);
  expect(rows.scheduled.map((row) => row.chatGuid)).toEqual([SIBLING]);
  expect(rows.suggestions).toHaveLength(0);
  expect(rows.triage).toHaveLength(0);
  await t.mutation(internal.comma.internal.upsertConversations, { conversations: [snapshot([SIBLING])] });
  const reconciled = await read();
  expect(reconciled.conversation).toMatchObject({ chatGuids: [SIBLING], lastMessage: { guid: "surviving-message" } });
  expect(reconciled.aliases.map((row) => row.chatGuid)).toEqual([SIBLING]);
  expect(reconciled.messages.map((row) => row.guid)).toEqual(["surviving-message"]);
});

test("delete the last alias and all its mirrored rows while preserving command receipts", async () => {
  const { t, conversationId } = await seed([CHAT]);
  const commandId = await t.run((ctx) => ctx.db.insert("comma_outbox", { conversationId, clientKey: "delete",
    payload: { kind: "deleteChat", chatGuid: CHAT }, status: "claimed", claimToken: "token", attempts: 1, createdAt: 1, updatedAt: 1 }));
  await removeChat(t, CHAT);
  await t.run(async (ctx) => {
    expect(await ctx.db.get(conversationId)).toBeNull();
    expect(await ctx.db.get(commandId)).not.toBeNull();
    for (const table of ["comma_chat_aliases", "comma_messages", "comma_attachments", "comma_conversation_state", "comma_drafts", "comma_presence", "comma_scheduled", "comma_suggestions", "comma_triage_open", "comma_triage_events"] as const) {
      expect(await ctx.db.query(table).collect()).toEqual([]);
    }
  });
  await t.mutation(internal.comma.internal.upsertConversations, { conversations: [] });
  expect(await t.run((ctx) => ctx.db.query("comma_conversations").collect())).toEqual([]);
});

test("deleting an absent alias is a no-op", async () => {
  const { t, conversationId } = await seed();
  expect(await t.mutation(deletion, { chatGuid: "absent" })).toEqual({ done: true });
  expect(await t.run((ctx) => ctx.db.get(conversationId))).not.toBeNull();
});

test("deletion scans multiple pages without dropping surviving service messages", async () => {
  const { t, conversationId } = await seed();
  await t.run(async (ctx) => {
    for (let i = 0; i < 250; i++) await ctx.db.insert("comma_messages", {
      guid: `history-${i}`, conversationId, chatGuid: i % 2 ? SIBLING : CHAT, dateCreated: 3000 + i,
      isFromMe: false, text: String(i), service: i % 2 ? "SMS" : "iMessage", error: 0,
      edited: false, retracted: false, isTapback: false, reactions: [], isGroupEvent: false,
      mentions: [], attachmentGuids: [], sourceVersion: 1,
    });
  });
  await removeChat(t, CHAT);
  await t.run(async (ctx) => {
    const messages = await ctx.db.query("comma_messages").collect();
    expect(messages).toHaveLength(126);
    expect(messages.every((row) => row.chatGuid === SIBLING)).toBe(true);
    expect(await ctx.db.get(conversationId)).toMatchObject({ primaryChatGuid: SIBLING, lastMessage: { guid: "history-249" } });
  });
});
