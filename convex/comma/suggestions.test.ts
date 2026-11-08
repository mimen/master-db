import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import type { commandSuggestions, suggestionDoc } from "../schema/comma/validators";
import { normalizeModules } from "../test-utils.vitest";

import type { ShelfUpdate } from "./suggestions";
import { namePerson } from "./testModules.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const publishRef = makeFunctionReference<"mutation", { update: ShelfUpdate }, boolean>("comma/suggestions:publish");
const getRef = makeFunctionReference<"query", { chatGuid: string; model: "opus" | "terra" }, typeof suggestionDoc.type | null>("comma/suggestions:getSuggestions");
const statusRef = makeFunctionReference<"query", Record<string, never>, { suggestions: boolean; reactionSuggestions: boolean; agentHeartbeatAt: number | null }>("comma/suggestions:aiStatus");
const CHAT = "iMessage;-;+15550001111";

beforeEach(() => { process.env.COMMA_BRIDGE_SECRET = "test"; });

async function fixture() {
  const t = convexTest(schema, modules);
  const conversationId = await t.run(async (ctx) => {
    const conversationId = await ctx.db.insert("comma_conversations", {
      conversationKey: "dm:test", primaryChatGuid: CHAT, chatGuids: [CHAT], displayName: "Alex", isGroup: false,
      participants: [{ address: "+15550001111", name: "Alex" }], isSpam: false, hasGroupPhoto: false,
      lastMessage: { guid: "m1", text: "hey?", dateCreated: 1, isFromMe: false, senderName: "Alex", hasAttachments: false },
      lastMessageAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("comma_chat_aliases", { chatGuid: CHAT, conversationId, service: "iMessage" });
    return conversationId;
  });
  const publish = (model: "opus" | "terra", overrides: Partial<typeof commandSuggestions.type> = {}, startedAt = 1) => t.mutation(publishRef, { update: {
    kind: "publish", conversationId, model, startedAt,
    suggestions: { suggestions: [], event: null, recipeVersion: 3, selectedModel: model, servedModel: model,
      fallback: false, noReply: false, basedOnMessageGuid: "m1", stale: false, generatedAt: 2, ...overrides },
  } });
  return { t, authed: t.withIdentity({ email: ALLOWED_EMAIL }), conversationId, publish };
}

test("publishes separate model shelves, preserves fallback metadata, and replaces only the selected model", async () => {
  const h = await fixture();
  expect(await h.publish("opus", { servedModel: "terra", fallback: true })).toBe(true);
  expect(await h.publish("terra")).toBe(true);
  expect(await h.publish("opus", { generatedAt: 3, noReply: true })).toBe(true);
  expect(await h.authed.query(getRef, { chatGuid: CHAT, model: "opus" })).toMatchObject({ model: "opus", createdAt: 3, payload: { noReply: true } });
  expect(await h.authed.query(getRef, { chatGuid: CHAT, model: "terra" })).toMatchObject({ model: "terra", createdAt: 2 });
  expect(await h.publish("opus", { generatedAt: 2 })).toBe(false);
  expect(await h.t.run((ctx) => ctx.db.query("comma_suggestions").collect())).toHaveLength(2);
});

test("only reads cached shelves with a current anchor and matching selected model", async () => {
  const h = await fixture();
  await h.publish("opus");
  expect(await h.authed.query(getRef, { chatGuid: CHAT, model: "terra" })).toBeNull();
  expect(await h.publish("terra", { selectedModel: "opus" })).toBe(false);
  await h.t.run(async (ctx) => {
    const row = await ctx.db.get(h.conversationId);
    await ctx.db.patch(h.conversationId, { lastMessage: { ...row!.lastMessage!, guid: "m2" } });
  });
  expect(await h.authed.query(getRef, { chatGuid: CHAT, model: "opus" })).toBeNull();
  expect(await h.publish("terra")).toBe(false);
  expect(await h.publish("opus", { basedOnMessageGuid: "m2", stale: true })).toBe(false);
  expect(await h.publish("opus", { basedOnMessageGuid: "m2", generatedAt: 4 })).toBe(true);
  await h.t.run(async (ctx) => {
    const row = await ctx.db.get(h.conversationId);
    await ctx.db.patch(h.conversationId, { lastMessage: { ...row!.lastMessage!, isFromMe: true } });
  });
  expect(await h.authed.query(getRef, { chatGuid: CHAT, model: "opus" })).toBeNull();
  expect(await h.publish("opus", { basedOnMessageGuid: "m2" })).toBe(false);
});

test("reads legacy opus shelves and migrates them on publish", async () => {
  const h = await fixture();
  await h.publish("opus");
  await h.t.run(async (ctx) => {
    const shelf = (await ctx.db.query("comma_suggestions").collect())[0]!;
    await ctx.db.patch(shelf._id, { model: undefined });
  });
  expect(await h.authed.query(getRef, { chatGuid: CHAT, model: "opus" })).not.toBeNull();
  expect(await h.authed.query(getRef, { chatGuid: CHAT, model: "terra" })).toBeNull();
  await h.publish("opus", { generatedAt: 3 });
  expect(await h.t.run((ctx) => ctx.db.query("comma_suggestions").collect())).toMatchObject([{ model: "opus" }]);
});

test("global clear invalidates all shelves, fences old generations, and deduplicates retries", async () => {
  const h = await fixture();
  await h.publish("opus"); await h.publish("terra");
  const otherId = await h.t.run(async (ctx) => {
    const row = await ctx.db.get(h.conversationId);
    const { _id: _id, _creationTime: _creationTime, ...fields } = row!;
    const id = await ctx.db.insert("comma_conversations", { ...fields, conversationKey: "dm:other", primaryChatGuid: "other", chatGuids: ["other"] });
    const shelf = (await ctx.db.query("comma_suggestions").collect())[0]!;
    await ctx.db.insert("comma_suggestions", { conversationId: id, model: "opus", anchorGuid: "m1", payload: shelf.payload, createdAt: 2 });
    return id;
  });
  expect(otherId).toBeTruthy();
  const update = { kind: "clear" as const, clientKey: "clear-1", clearedAt: 10 };
  expect(await h.t.mutation(publishRef, { update })).toBe(true);
  expect(await h.t.run((ctx) => ctx.db.query("comma_suggestions").collect())).toEqual([]);
  expect(await h.publish("opus", { generatedAt: 20 }, 5)).toBe(false);
  expect(await h.publish("opus", { generatedAt: 21 }, 11)).toBe(true);
  await h.t.mutation(publishRef, { update: { ...update, clearedAt: 30 } });
  expect(await h.authed.query(getRef, { chatGuid: CHAT, model: "opus" })).not.toBeNull();
});

test("capabilities come from the AI process's status and are unavailable until it exists", async () => {
  const h = await fixture();
  expect(await h.authed.query(statusRef, {})).toEqual({ suggestions: false, reactionSuggestions: false, agentHeartbeatAt: null });
  await h.t.run((ctx) => ctx.db.insert("comma_bridge_state", { key: "ai", connected: true, lastSeenAt: 1, capabilities: { executor: "ai" as const, suggestions: true, whisperAvailable: false } }));
  expect(await h.authed.query(statusRef, {})).toEqual({ suggestions: true, reactionSuggestions: false, agentHeartbeatAt: null });
  await expect(h.t.query(statusRef, {})).rejects.toThrow("Unauthorized");
  await expect(h.t.query(getRef, { chatGuid: CHAT, model: "opus" })).rejects.toThrow("Unauthorized");
});

describe("precompute", () => {
  const ALEX = "+15550001111";
  const inbound = (conversationId: Id<"comma_conversations">, guid: string, overrides: Record<string, unknown> = {}) => ({
    guid, conversationId, chatGuid: CHAT, dateCreated: Date.now(), isFromMe: false, text: guid, service: "iMessage" as const,
    sender: { address: ALEX, name: null }, error: 0, edited: false, retracted: false, isTapback: false, reactions: [],
    isGroupEvent: false, mentions: [], attachmentGuids: [], sourceVersion: 1, ...overrides,
  });
  async function world(options: { known?: boolean; group?: boolean; ai?: boolean; aiSeenAt?: number } = {}) {
    const t = convexTest(schema, modules);
    const map = await t.mutation(internal.comma.internal.upsertConversations, { conversations: [{
      conversationKey: options.group ? "group:x" : `dm:${ALEX}`, chats: [{ chatGuid: CHAT, lastMessageAt: 1 }], displayName: "Alex",
      isGroup: options.group ?? false, participants: options.group ? [{ address: ALEX, name: null }, { address: "+15550002222", name: null }] : [{ address: ALEX, name: null }],
      isSpam: false, hasGroupPhoto: false, lastMessageAt: 1,
    }] });
    const conversationId = map[CHAT]!;
    await t.run(async (ctx) => {
      if (options.known ?? true) await namePerson(ctx, ALEX, "Alex Rivera");
      if (options.ai ?? true) await ctx.db.insert("comma_bridge_state", { key: "ai", connected: true, lastSeenAt: options.aiSeenAt ?? Date.now(), capabilities: { executor: "ai", suggestions: true, whisperAvailable: false } });
    });
    const post = (...messages: ReturnType<typeof inbound>[]) => t.mutation(internal.comma.internal.upsertMessages, { messages });
    const queued = async () => {
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      return (await t.run((ctx) => ctx.db.query("comma_outbox").collect())).map((row) => [row.clientKey, row.lane, row.payload]);
    };
    return { conversationId, post, queued };
  }
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test("a fresh inbound message in a known DM queues one suggestions command for the AI lane, for the newest message only", async () => {
    const w = await world();
    await w.post(inbound(w.conversationId, "m1", { dateCreated: Date.now() - 1 }), inbound(w.conversationId, "m2"));
    await w.post(inbound(w.conversationId, "m2"));
    expect(await w.queued()).toEqual([
      [`precompute:${w.conversationId}:m2`, "aiBackground", { kind: "suggestions", model: "opus", refresh: false, precompute: true }],
    ]);
  });

  test.each([
    ["history a backfill posts", {}, { dateCreated: Date.now() - 11 * 60_000 }],
    ["a group", { group: true }, {}],
    ["an unknown sender", { known: false }, {}],
    ["no AI process", { ai: false }, {}],
    ["an AI process that stopped beating", { aiSeenAt: Date.now() - 4 * 60_000 }, {}],
    ["my own message", {}, { isFromMe: true }],
  ])("%s queues nothing", async (_label, options, overrides) => {
    const w = await world(options);
    await w.post(inbound(w.conversationId, "m1", overrides));
    expect(await w.queued()).toEqual([]);
  });

  test("a reply before the debounce ends cancels it", async () => {
    const w = await world();
    await w.post(inbound(w.conversationId, "m1"));
    await w.post(inbound(w.conversationId, "mine", { isFromMe: true, dateCreated: Date.now() + 1 }));
    expect(await w.queued()).toEqual([]);
  });
});
