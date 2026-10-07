import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import type { CommaOutboxPayload } from "../schema/comma/validators";
import { normalizeModules } from "../test-utils.vitest";

import { AUTO_RETRY } from "./outbox";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const SECRET = "bridge-secret";
const previous = process.env.COMMA_BRIDGE_SECRET;
beforeEach(() => {
  process.env.COMMA_BRIDGE_SECRET = SECRET;
});
afterEach(() => {
  if (previous === undefined) delete process.env.COMMA_BRIDGE_SECRET;
  else process.env.COMMA_BRIDGE_SECRET = previous;
});

type T = TestConvex<typeof schema>;

async function setup(): Promise<{ t: T; as: ReturnType<T["withIdentity"]>; c: Id<"comma_conversations"> }> {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const c = await t.run((ctx) =>
    ctx.db.insert("comma_conversations", {
      conversationKey: "dm:+15550001111",
      primaryChatGuid: "iMessage;-;+15550001111",
      chatGuids: ["iMessage;-;+15550001111"],
      displayName: "Alex",
      isGroup: false,
      participants: [],
      lastMessageAt: 1,
      isSpam: false,
      hasGroupPhoto: false,
      updatedAt: 1,
    }),
  );
  return { t, as: t.withIdentity({ subject: `${userId}|session` }), c };
}

const send = { kind: "send" as const, text: "hello" };

describe("enqueue", () => {
  test("is idempotent on clientKey and inserts one temp bubble", async () => {
    const { t, as, c } = await setup();
    const a = await as.mutation(api.comma.outbox.enqueue, { clientKey: "k1", conversationId: c, payload: send });
    const b = await as.mutation(api.comma.outbox.enqueue, { clientKey: "k1", conversationId: c, payload: send });
    const temps = await t.run((ctx) => ctx.db.query("comma_messages").collect());
    expect(a).toBe(b);
    expect(temps.map((m) => [m.guid, m.text, m.clientKey])).toEqual([["temp-k1", "hello", "k1"]]);
  });

  test.each([
    ["iMessage;-;+15550001111", "iMessage"],
    ["SMS;-;+15550001111", "SMS"],
    ["RCS;-;+15550001111", "SMS"],
  ])("a send out on %s gets a %s temp bubble", async (primaryChatGuid, service) => {
    const { t, as, c } = await setup();
    await t.run((ctx) => ctx.db.patch(c, { primaryChatGuid, chatGuids: [primaryChatGuid] }));
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "k1", conversationId: c, payload: send });
    const [temp] = await t.run((ctx) => ctx.db.query("comma_messages").collect());
    expect(temp?.service).toBe(service);
  });

  test("requires Convex Auth", async () => {
    const { t, c } = await setup();
    await expect(t.mutation(api.comma.outbox.enqueue, { clientKey: "k", conversationId: c, payload: send })).rejects.toThrow();
  });
});

describe("the echo", () => {
  test("replaces the temp row that carries the same clientKey", async () => {
    const { t, as, c } = await setup();
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "k1", conversationId: c, payload: send });
    await t.mutation(internal.comma.internal.upsertMessages, {
      messages: [
        {
          guid: "real-1",
          conversationId: c,
          chatGuid: "iMessage;-;+15550001111",
          dateCreated: 5,
          isFromMe: true,
          text: "hello",
          service: "iMessage",
          error: 0,
          edited: false,
          retracted: false,
          isTapback: false,
          reactions: [],
          isGroupEvent: false,
          mentions: [],
          attachmentGuids: [],
          clientKey: "k1",
          sourceVersion: 1000,
        },
      ],
    });
    const guids = await t.run(async (ctx) => (await ctx.db.query("comma_messages").collect()).map((m) => m.guid));
    expect(guids).toEqual(["real-1"]);
  });
});

describe("claim and complete", () => {
  test("an expired lease makes a send unknown but returns an idempotent kind to pending", async () => {
    const { t, as, c } = await setup();
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "s", conversationId: c, payload: send });
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "p", conversationId: c, payload: { kind: "pin", value: true } });
    const claimed = await t.mutation(internal.comma.outbox.claimOutbox, { now: 1000, leaseMs: 100, limit: 10 });
    expect(claimed.map((r) => r.clientKey).sort()).toEqual(["p", "s"]);
    await t.mutation(internal.comma.outbox.claimOutbox, { now: 5000, leaseMs: 100, limit: 0 });
    const rows = await t.run((ctx) => ctx.db.query("comma_outbox").collect());
    const status = Object.fromEntries(rows.map((r) => [r.clientKey, r.status]));
    expect(status).toEqual({ s: "unknown", p: "pending" });
  });

  const real = (c: Id<"comma_conversations">, guid: string, clientKey?: string) => ({
    guid, conversationId: c, chatGuid: "iMessage;-;+15550001111", dateCreated: 5, isFromMe: true, text: "hello",
    service: "iMessage" as const, error: 0, edited: false, retracted: false, isTapback: false, reactions: [], isGroupEvent: false,
    mentions: [], attachmentGuids: [], sourceVersion: 1000, ...(clientKey ? { clientKey } : {}),
  });
  const rows = (t: T) => t.run(async (ctx) => ({
    guids: (await ctx.db.query("comma_messages").collect()).map((m) => m.guid),
    last: (await ctx.db.query("comma_conversations").first())?.lastMessage?.guid,
  }));

  test("a send moves the conversation preview before the bridge sees it", async () => {
    const { t, as, c } = await setup();
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "s", conversationId: c, payload: send });
    const conversation = await t.run((ctx) => ctx.db.get(c));
    expect(conversation?.lastMessage).toMatchObject({ guid: "temp-s", text: "hello", isFromMe: true });
    expect(conversation?.lastMessageAt).toBeGreaterThan(1);
  });

  test("a confirmed send keeps its temp until the real row lands, whichever arrives first", async () => {
    for (const echoFirst of [false, true]) {
      const { t, as, c } = await setup();
      await as.mutation(api.comma.outbox.enqueue, { clientKey: "s", conversationId: c, payload: send });
      const [claim] = await t.mutation(internal.comma.outbox.claimOutbox, { now: 1, leaseMs: 1000, limit: 10 });
      const complete = () => t.mutation(internal.comma.outbox.completeOutbox, { clientKey: "s", claimToken: claim.claimToken!, status: "sent", resultGuid: "REAL-GUID" });
      const echo = () => t.mutation(internal.comma.internal.upsertMessages, { messages: [real(c, "REAL-GUID")] });
      await (echoFirst ? echo() : complete());
      expect((await rows(t)).guids).toContain(echoFirst ? "REAL-GUID" : "temp-s");
      await (echoFirst ? complete() : echo());
      expect(await rows(t)).toEqual({ guids: ["REAL-GUID"], last: "REAL-GUID" });
    }
  });

  test("complete records the outcome", async () => {
    const { t, as, c } = await setup();
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "s", conversationId: c, payload: send });
    const [claim] = await t.mutation(internal.comma.outbox.claimOutbox, { now: 1, leaseMs: 1000, limit: 10 });
    await t.mutation(internal.comma.outbox.completeOutbox, { clientKey: "s", claimToken: claim.claimToken!, status: "failed", error: "BB 500" });
    const states = await as.query(api.comma.outbox.outboxStatusFor, { clientKeys: ["s"] });
    expect(states).toEqual([{ clientKey: "s", status: "failed", error: "BB 500" }]);
  });
});

describe("pendingOutbox", () => {
  test("only answers the bridge secret", async () => {
    const { t, as, c } = await setup();
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "s", conversationId: c, payload: send });
    await expect(t.query(api.comma.outbox.pendingOutbox, { bridgeKey: "wrong" })).rejects.toThrow();
    const rows = await t.query(api.comma.outbox.pendingOutbox, { bridgeKey: SECRET });
    expect(rows.map((r) => r.clientKey)).toEqual(["s"]);
  });
});

test("global/new-chat commands enqueue without a conversation; other kinds require an existing one", async () => {
  const { t, as, c } = await setup();
  for (const payload of [{ kind: "createChat" as const, addresses: ["one"], text: "hi" }, { kind: "clearSuggestionLearning" as const }]) {
    const id = await as.mutation(api.comma.outbox.enqueue, { clientKey: payload.kind, payload });
    expect((await t.run((ctx) => ctx.db.get(id)))?.conversationId).toBeUndefined();
    expect(await as.mutation(api.comma.outbox.enqueue, { clientKey: payload.kind, payload })).toBe(id);
  }
  await expect(as.mutation(api.comma.outbox.enqueue, { clientKey: "bad", payload: send })).rejects.toThrow("conversationId is required");
  await t.run((ctx) => ctx.db.delete(c));
  await expect(as.mutation(api.comma.outbox.enqueue, { clientKey: "missing", conversationId: c, payload: send })).rejects.toThrow("Conversation not found");
});

test("getCommand authenticates and returns only the receipt, including validated typed results", async () => {
  const { t, as, c } = await setup();
  const commandId = await as.mutation(api.comma.outbox.enqueue, { clientKey: "typed", conversationId: c, payload: { kind: "pin", value: true } });
  await expect(t.query(api.comma.outbox.getCommand, { commandId })).rejects.toThrow();
  const [claim] = await t.mutation(internal.comma.outbox.claimOutbox, { now: 1000, leaseMs: 100, limit: 1 });
  const args = { clientKey: "typed", claimToken: claim.claimToken!, status: "sent" as const };
  await expect(t.mutation(internal.comma.outbox.completeOutbox, { ...args, result: { kind: "mute", ok: true } })).rejects.toThrow("Result kind");
  await expect(t.mutation(internal.comma.outbox.completeOutbox, { ...args, result: { kind: "pin", ok: false } as never })).rejects.toThrow();
  await t.mutation(internal.comma.outbox.completeOutbox, { ...args, result: { kind: "pin", ok: true } });
  expect(await as.query(api.comma.outbox.getCommand, { commandId })).toEqual({ commandId, clientKey: "typed", status: "sent", result: { kind: "pin", ok: true }, updatedAt: expect.any(Number) });
  await t.run((ctx) => ctx.db.delete(commandId));
  expect(await as.query(api.comma.outbox.getCommand, { commandId })).toBeNull();
});

test("renewal is fenced, cannot resurrect an expired lease, and prevents expiry while live", async () => {
  const { t, as, c } = await setup();
  const commandId = await as.mutation(api.comma.outbox.enqueue, { clientKey: "lease", conversationId: c, payload: { kind: "identify" } });
  const [first] = await t.mutation(internal.comma.outbox.claimOutbox, { now: 1000, leaseMs: 100, limit: 1 });
  const renew = { clientKey: "lease", now: 1050, leaseMs: 100, claimToken: first.claimToken! };
  expect(await t.mutation(internal.comma.outbox.renewOutbox, { ...renew, claimToken: "stale" })).toBe(false);
  expect(await t.mutation(internal.comma.outbox.renewOutbox, renew)).toBe(true);
  expect(await t.mutation(internal.comma.outbox.claimOutbox, { now: 1120, leaseMs: 100, limit: 1 })).toEqual([]);
  expect(await t.mutation(internal.comma.outbox.renewOutbox, { ...renew, now: 1150 })).toBe(false);
  const [second] = await t.mutation(internal.comma.outbox.claimOutbox, { now: 1200, leaseMs: 100, limit: 1 });
  expect(second.claimToken).not.toBe(first.claimToken);
  const before = await t.run((ctx) => ctx.db.get(commandId));
  expect(await t.mutation(internal.comma.outbox.completeOutbox, { clientKey: "lease", claimToken: first.claimToken!, status: "failed", error: "late" })).toBe(false);
  expect(await t.mutation(internal.comma.outbox.renewOutbox, { ...renew, now: 1250 })).toBe(false);
  expect(await t.run((ctx) => ctx.db.get(commandId))).toEqual(before);
  expect(await t.mutation(internal.comma.outbox.completeOutbox, { clientKey: "lease", claimToken: second.claimToken!, status: "sent", result: { kind: "identify", contact: { name: null, confidence: "low", reasoning: "test" } } })).toBe(true);
  const terminal = await t.run((ctx) => ctx.db.get(commandId));
  // Duplicate receipts are acknowledged without rewriting terminal data.
  expect(await t.mutation(internal.comma.outbox.completeOutbox, { clientKey: "lease", claimToken: second.claimToken!, status: "sent" })).toBe(true);
  expect(await t.run((ctx) => ctx.db.get(commandId))).toEqual(terminal);
});

test("every new kind has the specified expiry policy and legacy claims remain valid", async () => {
  const { t, c } = await setup();
  const retryable = ["pin", "mute", "markRead", "markUnread", "settle", "unsettle", "rename", "typing", "clearSuggestionLearning", "suggestions", "identify", "transcribe"];
  expect(Object.keys(AUTO_RETRY).filter((kind) => AUTO_RETRY[kind as keyof typeof AUTO_RETRY]).sort()).toEqual(retryable.sort());
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["attachment"])));
  const payloads: CommaOutboxPayload[] = [
    { kind: "sendAttachment", storageId, filename: "a.txt", mimeType: "text/plain", isAudioMessage: false },
    { kind: "suggestionFeedback", feedback: { suggestion: { id: "s", kind: "text", strategy: "answer", vibe: "affirmative", text: "yes", reaction: null, targetMessageGuid: null, targetMessagePreview: null, targetPartIndex: null }, selectedModel: "opus", servedModel: "opus", recipeVersion: 1, selectedAt: 1, finalText: "yes" } },
    { kind: "createChat", addresses: [], text: "hi" }, { kind: "sendContact", name: "a", address: "a" },
    { kind: "participant", address: "a", action: "add" }, { kind: "leaveGroup" }, { kind: "deleteChat", chatGuid: "a" },
    { kind: "sendScheduledNow", bbId: 1 }, { kind: "createFaceTimeLink" }, { kind: "typing", active: true, expiresAt: 3 },
    { kind: "clearSuggestionLearning" }, { kind: "suggestions", model: "terra", refresh: true }, { kind: "identify" },
    { kind: "transcribe", attachmentGuid: "a" },
  ];
  for (const payload of payloads) {
    // A legacy claimed row can have no claim token until the next claim.
    await t.run((ctx) => ctx.db.insert("comma_outbox", { clientKey: payload.kind, conversationId: c,
      payload,
      status: "claimed", attempts: 1, leaseUntil: 10, createdAt: 1, updatedAt: 1 }));
  }
  await t.mutation(internal.comma.outbox.claimOutbox, { now: 20, leaseMs: 100, limit: 0 });
  for (const row of await t.run((ctx) => ctx.db.query("comma_outbox").collect())) {
    expect(row.status).toBe(AUTO_RETRY[row.payload.kind] ? "pending" : "unknown");
    expect(row.claimToken).toBeUndefined();
  }
});

test("an expired side-effect claim cannot overwrite unknown with a late receipt", async () => {
  const { t, as, c } = await setup();
  const commandId = await as.mutation(api.comma.outbox.enqueue, { clientKey: "late-send", conversationId: c, payload: send });
  const [claim] = await t.mutation(internal.comma.outbox.claimOutbox, { now: 100, leaseMs: 100, limit: 1 });
  await t.mutation(internal.comma.outbox.claimOutbox, { now: 300, leaseMs: 100, limit: 0 });
  expect(await t.mutation(internal.comma.outbox.completeOutbox, { clientKey: "late-send", claimToken: claim.claimToken!, status: "sent" })).toBe(false);
  expect((await as.query(api.comma.outbox.getCommand, { commandId }))?.status).toBe("unknown");
  const outsiderId = await t.run((ctx) => ctx.db.insert("users", { email: "outsider@example.com" }));
  await expect(t.withIdentity({ subject: `${outsiderId}|session` }).query(api.comma.outbox.getCommand, { commandId })).rejects.toThrow();
});

test("the full cutover schema keeps legacy rows valid and registers new state tables and indexes", async () => {
  const { t, as, c } = await setup();
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["photo"])));
  await t.run(async (ctx) => {
    await ctx.db.patch(c, { rawDisplayName: "raw", groupPhotoGuid: "photo", groupPhotoStorageId: storageId });
    await ctx.db.insert("comma_attachments", { guid: "voice", messageGuid: "m", conversationId: c,
      isSticker: false, hideAttachment: false, isOnDisk: true, sourceVersion: 1,
      transcriptState: "failed", transcriptError: "unavailable", transcriptDetail: "local model missing" });
    const shelf = { conversationId: c, anchorGuid: "m", createdAt: 1, payload: { suggestions: [], event: null,
      recipeVersion: 1, selectedModel: "opus" as const, servedModel: "opus" as const, fallback: false, noReply: true } };
    await ctx.db.insert("comma_suggestions", shelf);
    await ctx.db.insert("comma_suggestions", { ...shelf, model: "terra" });
    expect(await ctx.db.query("comma_suggestions").withIndex("by_conversation_model", (q) => q.eq("conversationId", c).eq("model", "terra")).collect()).toHaveLength(1);
    await ctx.db.insert("comma_presence", { conversationId: c, peerTyping: true, updatedAt: 1, expiresAt: 10 });
    await ctx.db.insert("comma_bridge_state", { key: "mini", privateApi: true, suggestions: true, reactionSuggestions: true, whisperAvailable: false, whisperDetail: "no model", lastSeenAt: 1 });
    await ctx.db.insert("comma_uploads", { storageId, filename: "photo.jpg", mimeType: "image/jpeg", totalBytes: 5, createdAt: 1 });
  });
  await as.mutation(api.comma.outbox.enqueue, { clientKey: "search", conversationId: c, payload: send });
  expect(await t.run((ctx) => ctx.db.query("comma_messages").withSearchIndex("search_text", (q) => q.search("text", "hello").eq("isFromMe", true)).collect())).toHaveLength(1);
});
