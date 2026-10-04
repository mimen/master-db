import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { beforeEach, expect, test } from "vitest";

import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import type { commandSuggestions, suggestionDoc } from "../schema/comma/validators";
import { normalizeModules } from "../test-utils.vitest";

import type { ShelfUpdate } from "./suggestions";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const publishRef = makeFunctionReference<"mutation", { update: ShelfUpdate }, boolean>("comma/suggestions:publish");
const getRef = makeFunctionReference<"query", { chatGuid: string; model: "opus" | "terra" }, typeof suggestionDoc.type | null>("comma/suggestions:getSuggestions");
const statusRef = makeFunctionReference<"query", Record<string, never>, { suggestions: boolean; reactionSuggestions: boolean }>("comma/suggestions:aiStatus");
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

test("capabilities come from the singleton and are unavailable until it exists", async () => {
  const h = await fixture();
  expect(await h.authed.query(statusRef, {})).toEqual({ suggestions: false, reactionSuggestions: false });
  await h.t.run((ctx) => ctx.db.insert("comma_bridge_state", {
    key: "mini", privateApi: true, suggestions: true, reactionSuggestions: false, whisperAvailable: false, lastSeenAt: 1,
  }));
  expect(await h.authed.query(statusRef, {})).toEqual({ suggestions: true, reactionSuggestions: false });
  await expect(h.t.query(statusRef, {})).rejects.toThrow("Unauthorized");
  await expect(h.t.query(getRef, { chatGuid: CHAT, model: "opus" })).rejects.toThrow("Unauthorized");
});
