import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { todayWindow } from "../../apps/imsg/shared/today";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import type { CommaOutboxPayload } from "../schema/comma/validators";
import { normalizeModules } from "../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const previous = process.env.COMMA_BRIDGE_SECRET;
beforeEach(() => {
  process.env.COMMA_BRIDGE_SECRET = "bridge-secret";
});
afterEach(() => {
  if (previous === undefined) delete process.env.COMMA_BRIDGE_SECRET;
  else process.env.COMMA_BRIDGE_SECRET = previous;
});

type T = TestConvex<typeof schema>;
type ConversationId = Id<"comma_conversations">;
const CHAT = "iMessage;-;+15550001111";

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const c = await t.run((ctx) => ctx.db.insert("comma_conversations", {
    conversationKey: "dm:+15550001111", primaryChatGuid: CHAT, chatGuids: [CHAT], displayName: "Sprout Imen",
    isGroup: false, participants: [], lastMessageAt: 0, isSpam: false, hasGroupPhoto: false, updatedAt: 0,
  }));
  return { t, as: t.withIdentity({ subject: `${userId}|session` }), c };
}

function ingest(t: T, c: ConversationId, ...messages: { guid: string; at: number; fromMe: boolean; clientKey?: string }[]) {
  return t.mutation(internal.comma.internal.upsertMessages, {
    messages: messages.map(({ guid, at, fromMe, clientKey }) => ({
      guid, conversationId: c, chatGuid: CHAT, dateCreated: at, isFromMe: fromMe, text: guid, service: "iMessage" as const,
      error: 0, edited: false, retracted: false, isTapback: false, reactions: [], isGroupEvent: false, mentions: [],
      attachmentGuids: [], ...(clientKey ? { clientKey } : {}), sourceVersion: 1,
    })),
  });
}

async function row(as: ReturnType<T["withIdentity"]>, c: ConversationId) {
  const conversation = await as.query(api.comma.queries.getConversation, { conversationId: c });
  if (!conversation) throw new Error("missing conversation");
  return conversation;
}

const events = (t: T) => t.run(async (ctx) => (await ctx.db.query("comma_triage_events").collect())
  .map(({ messageGuid, reason, clearedAt }) => ({ messageGuid, reason, clearedAt })));

/** The Mini's claim queue as the bridge sees it. */
const claimable = (t: T) => t.mutation(internal.comma.outbox.claimOutbox, { now: Date.now(), leaseMs: 60_000, limit: 50 });

describe("settle", () => {
  test("clears Needs you on an inbound last message and logs the dismissal", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false });
    expect((await row(as, c)).flags.unresponded).toBe(true);
    await as.mutation(api.comma.triage.settle, { conversationId: c, anchor: "in-1" });
    expect((await row(as, c)).flags).toMatchObject({ unresponded: false, waiting: false });
    expect(await events(t)).toEqual([expect.objectContaining({ messageGuid: "in-1", reason: "dismiss" })]);
  });

  test("clears Waiting on an outbound last message", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "out-1", at: 10, fromMe: true });
    expect((await row(as, c)).flags.waiting).toBe(true);
    await as.mutation(api.comma.triage.settle, { conversationId: c, anchor: "out-1" });
    expect((await row(as, c)).flags).toMatchObject({ unresponded: false, waiting: false });
  });

  test("rejects an anchor that is not the last message, and writes nothing", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false }, { guid: "in-2", at: 20, fromMe: false });
    await expect(as.mutation(api.comma.triage.settle, { conversationId: c, anchor: "in-1" })).rejects.toThrow("latest message changed");
    expect((await row(as, c)).flags.unresponded).toBe(true);
    expect(await events(t)).toEqual([]);
  });

  test("settles on the shown last message when three messages share a timestamp", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "same-a", at: 10, fromMe: false }, { guid: "same-b", at: 10, fromMe: false }, { guid: "same-c", at: 10, fromMe: false });
    const shown = (await row(as, c)).lastMessage!.guid;
    await as.mutation(api.comma.triage.settle, { conversationId: c, anchor: shown });
    expect((await row(as, c)).flags.unresponded).toBe(false);
  });

  test("a settle taken on a send still in flight holds once its real message replaces the temp row", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false });
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "k1", conversationId: c, payload: { kind: "send", text: "on it" } });
    await as.mutation(api.comma.triage.settle, { conversationId: c });
    await ingest(t, c, { guid: "real-1", at: Date.now() + 1, fromMe: true, clientKey: "k1" });
    const settled = await row(as, c);
    expect(settled.lastMessage?.guid).toBe("real-1");
    expect(settled.flags).toMatchObject({ unresponded: false, waiting: false });
    await as.mutation(api.comma.triage.unsettle, { conversationId: c });
    expect((await events(t)).filter((event) => event.reason === "dismiss"), "unsettle finds the carried clear").toEqual([]);
  });

  test("requires Convex Auth", async () => {
    const { t, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false });
    await expect(t.mutation(api.comma.triage.settle, { conversationId: c })).rejects.toThrow("Unauthorized");
  });
});

describe("unsettle", () => {
  test("restores the flag and takes back the settle's clear", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false });
    await as.mutation(api.comma.triage.settle, { conversationId: c, anchor: "in-1" });
    await as.mutation(api.comma.triage.unsettle, { conversationId: c });
    expect((await row(as, c)).flags.unresponded).toBe(true);
    expect(await events(t)).toEqual([]);
  });
});

describe("pin, mute and mark unread", () => {
  test("each lands on the conversation's flags", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false });
    await as.mutation(api.comma.triage.setPinned, { conversationId: c, pinned: true });
    await as.mutation(api.comma.triage.markUnread, { conversationId: c });
    await as.mutation(api.comma.triage.setMuted, { conversationId: c, muted: true });
    expect((await row(as, c)).flags).toMatchObject({ pinned: true, unread: true });
    const state = await t.run((ctx) => ctx.db.query("comma_conversation_state").unique());
    expect(state).toMatchObject({ pinned: true, markedUnread: true, mutedUnresponded: true });
    await as.mutation(api.comma.triage.setPinned, { conversationId: c, pinned: false });
    expect((await row(as, c)).flags.pinned).toBe(false);
  });
});

describe("markRead", () => {
  test("reads in Convex, clears marked-unread and queues exactly one receipt for the Mini", async () => {
    const { t, as, c } = await setup();
    const at = Date.now();
    await ingest(t, c, { guid: "in-1", at: at - 1_000, fromMe: false });
    await t.run((ctx) => ctx.db.patch(c, { unread: { count: 3, firstAt: at - 1_000 } }));
    await as.mutation(api.comma.triage.markUnread, { conversationId: c });
    await as.mutation(api.comma.triage.markRead, { conversationId: c, at });
    const read = await row(as, c);
    expect(read.unreadCount).toBe(0);
    expect(read.flags.unread).toBe(false);
    expect((await claimable(t)).map((command) => command.payload)).toEqual([{ kind: "markRead" }]);
  });

  test("a failed receipt leaves the read in place", async () => {
    const { t, as, c } = await setup();
    const at = Date.now();
    await ingest(t, c, { guid: "in-1", at: at - 1_000, fromMe: false });
    await t.run((ctx) => ctx.db.patch(c, { unread: { count: 1, firstAt: at - 1_000 } }));
    const commandId = await as.mutation(api.comma.triage.markRead, { conversationId: c, at });
    const [claimed] = await claimable(t);
    await t.mutation(internal.comma.outbox.completeOutbox, {
      clientKey: claimed!.clientKey, claimToken: claimed!.claimToken!, status: "failed", error: "BlueBubbles mark read failed",
    });
    expect(await as.query(api.comma.outbox.getCommand, { commandId })).toMatchObject({ status: "failed", error: "BlueBubbles mark read failed" });
    expect((await row(as, c)).unreadCount).toBe(0);
  });

  test("a client clock ahead of the server cannot read messages that arrive later", async () => {
    const { t, as, c } = await setup();
    await as.mutation(api.comma.triage.markRead, { conversationId: c, at: Date.now() + 3_600_000 });
    await ingest(t, c, { guid: "in-1", at: Date.now() + 60_000, fromMe: false });
    await t.run((ctx) => ctx.db.patch(c, { unread: { count: 1, firstAt: Date.now() + 60_000 } }));
    expect((await row(as, c)).unreadCount).toBe(1);
  });
});

describe("reply clears", () => {
  test("a real reply logs a clear for the inbound message it answered, once", async () => {
    const { t, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false });
    await ingest(t, c, { guid: "out-1", at: 20, fromMe: true });
    await ingest(t, c, { guid: "out-2", at: 30, fromMe: true });
    await ingest(t, c, { guid: "out-1", at: 20, fromMe: true });
    expect(await events(t)).toEqual([{ messageGuid: "in-1", reason: "reply", clearedAt: 20 }]);
  });

  test("an inbound message the user already settled logs no reply", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false });
    await as.mutation(api.comma.triage.settle, { conversationId: c, anchor: "in-1" });
    await ingest(t, c, { guid: "out-1", at: 20, fromMe: true });
    expect((await events(t)).map((event) => event.reason)).toEqual(["dismiss"]);
  });

  test("a send still in flight is not a reply yet", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false });
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "k1", conversationId: c, payload: { kind: "send", text: "on it" } });
    await ingest(t, c, { guid: "in-0", at: 5, fromMe: false });
    expect(await events(t)).toEqual([]);
    await ingest(t, c, { guid: "real-1", at: Date.now() + 1, fromMe: true, clientKey: "k1" });
    expect((await events(t)).map((event) => [event.messageGuid, event.reason])).toEqual([["in-1", "reply"]]);
  });
  test("a reply ingested with a newer inbound message in one batch still logs the clear", async () => {
    const { t, c } = await setup();
    await ingest(t, c, { guid: "in-a", at: 10, fromMe: false });
    await ingest(t, c, { guid: "out-b", at: 20, fromMe: true }, { guid: "in-c", at: 30, fromMe: false });
    expect(await events(t)).toEqual([{ messageGuid: "in-a", reason: "reply", clearedAt: 20 }]);
  });

  test("a reply ingested before the inbound message it answered logs once that message lands", async () => {
    const { t, c } = await setup();
    await ingest(t, c, { guid: "out-b", at: 20, fromMe: true });
    await ingest(t, c, { guid: "in-a", at: 10, fromMe: false });
    expect(await events(t)).toEqual([{ messageGuid: "in-a", reason: "reply", clearedAt: 20 }]);
  });
});

describe("a settle on a send still in flight", () => {
  test("holds when the send lands and is the last message before the settle runs", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false });
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "k1", conversationId: c, payload: { kind: "send", text: "on it" } });
    await ingest(t, c, { guid: "real-1", at: Date.now() + 1, fromMe: true, clientKey: "k1" });
    await as.mutation(api.comma.triage.settle, { conversationId: c, anchor: "temp-k1" });
    expect((await row(as, c)).flags).toMatchObject({ unresponded: false, waiting: false });
  });

  test("never dismisses an inbound message that arrived after the send", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false });
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "k1", conversationId: c, payload: { kind: "send", text: "on it" } });
    const later = Date.now() + 1;
    await ingest(t, c, { guid: "real-1", at: later, fromMe: true, clientKey: "k1" }, { guid: "in-2", at: later + 1, fromMe: false });
    await expect(as.mutation(api.comma.triage.settle, { conversationId: c, anchor: "temp-k1" })).rejects.toThrow("latest message changed");
    expect((await row(as, c)).flags.unresponded).toBe(true);
  });
});

describe("a triage command queued before Convex owned it", () => {
  const queue = (t: T, c: ConversationId, clientKey: string, payload: CommaOutboxPayload) => t.run((ctx) => ctx.db.insert("comma_outbox", {
    clientKey, conversationId: c, payload, status: "pending", attempts: 0, createdAt: 50, updatedAt: 50,
  }));

  test("applies in Convex at claim time and never reaches the Mini", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false });
    await queue(t, c, "old-pin", { kind: "pin", value: true });
    await queue(t, c, "old-settle", { kind: "settle", messageGuid: "in-1" });
    await queue(t, c, "old-read", { kind: "markRead" });
    expect((await claimable(t)).map((claim) => claim.payload.kind)).toEqual(["markRead"]);
    const conversation = await row(as, c);
    expect(conversation.flags).toMatchObject({ pinned: true, unresponded: false });
    expect(await t.run(async (ctx) => (await ctx.db.query("comma_conversation_state").first())?.readAt)).toBe(50);
    const statuses = await as.query(api.comma.outbox.outboxStatusFor, { clientKeys: ["old-pin", "old-settle"] });
    expect(statuses.map((s) => s.status)).toEqual(["sent", "sent"]);
  });

  test("a stale anchor fails only its own command", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false }, { guid: "in-2", at: 20, fromMe: false });
    await queue(t, c, "old-settle", { kind: "settle", messageGuid: "in-1" });
    await queue(t, c, "old-pin", { kind: "pin", value: true });
    expect(await claimable(t)).toEqual([]);
    const statuses = await as.query(api.comma.outbox.outboxStatusFor, { clientKeys: ["old-settle", "old-pin"] });
    expect(statuses).toEqual([
      { clientKey: "old-settle", status: "failed", error: "latest message changed" },
      { clientKey: "old-pin", status: "sent" },
    ]);
  });
});

describe("enqueue from a client before comma/triage", () => {
  const cases: [CommaOutboxPayload, (flags: { unresponded: boolean; pinned: boolean; unread: boolean }) => boolean][] = [
    [{ kind: "settle", messageGuid: "in-1" }, (flags) => !flags.unresponded],
    [{ kind: "pin", value: true }, (flags) => flags.pinned],
    [{ kind: "markUnread" }, (flags) => flags.unread],
  ];
  test.each(cases)("%o applies in Convex and completes at once without reaching the Mini", async (payload, applied) => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false });
    const commandId = await as.mutation(api.comma.outbox.enqueue, { clientKey: "old-1", conversationId: c, payload });
    expect(await as.query(api.comma.outbox.getCommand, { commandId })).toMatchObject({ status: "sent", result: { kind: payload.kind, ok: true } });
    expect(applied((await row(as, c)).flags)).toBe(true);
    expect(await claimable(t)).toEqual([]);
    expect(await as.mutation(api.comma.outbox.enqueue, { clientKey: "old-1", conversationId: c, payload }), "idempotent on clientKey").toBe(commandId);
  });

  test("unsettle and mute apply in Convex and complete at once", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false });
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "old-1", conversationId: c, payload: { kind: "settle" } });
    const unsettle = await as.mutation(api.comma.outbox.enqueue, { clientKey: "old-2", conversationId: c, payload: { kind: "unsettle" } });
    const mute = await as.mutation(api.comma.outbox.enqueue, { clientKey: "old-3", conversationId: c, payload: { kind: "mute", value: true } });
    expect(await as.query(api.comma.outbox.getCommand, { commandId: unsettle })).toMatchObject({ status: "sent", result: { kind: "unsettle", ok: true } });
    expect(await as.query(api.comma.outbox.getCommand, { commandId: mute })).toMatchObject({ status: "sent", result: { kind: "mute", ok: true } });
    expect((await row(as, c)).flags.unresponded).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("comma_conversation_state").unique())).toMatchObject({ mutedUnresponded: true });
    expect(await claimable(t)).toEqual([]);
  });

  test("a stale settle anchor rejects the enqueue with the message the client maps to its toast", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false }, { guid: "in-2", at: 20, fromMe: false });
    await expect(as.mutation(api.comma.outbox.enqueue, { clientKey: "old-1", conversationId: c, payload: { kind: "settle", messageGuid: "in-1" } }))
      .rejects.toThrow("latest message changed");
    expect(await t.run((ctx) => ctx.db.query("comma_outbox").collect())).toEqual([]);
  });

  test("markRead reads in Convex and still goes to the Mini for the receipt", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, { guid: "in-1", at: 10, fromMe: false });
    await t.run((ctx) => ctx.db.patch(c, { unread: { count: 2, firstAt: 10 } }));
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "old-1", conversationId: c, payload: { kind: "markRead" } });
    expect((await row(as, c)).unreadCount).toBe(0);
    expect((await claimable(t)).map((command) => command.payload.kind)).toEqual(["markRead"]);
  });
});

describe("Today's clear log", () => {
  test("sees settles and replies made today", async () => {
    const { t, as, c } = await setup();
    const { day, start } = todayWindow(Date.now());
    await as.mutation(api.comma.today.requestBuild, { day, dayStart: start });
    const other = await t.run((ctx) => ctx.db.insert("comma_conversations", {
      conversationKey: "dm:+15550002222", primaryChatGuid: "iMessage;-;+15550002222", chatGuids: ["iMessage;-;+15550002222"],
      displayName: "Alex", isGroup: false, participants: [], lastMessageAt: 0, isSpam: false, hasGroupPhoto: false, updatedAt: 0,
    }));
    await ingest(t, c, { guid: "in-1", at: Date.now() - 1_000, fromMe: false });
    await as.mutation(api.comma.triage.settle, { conversationId: c, anchor: "in-1" });
    await ingest(t, other, { guid: "in-2", at: Date.now() - 2_000, fromMe: false }, { guid: "out-2", at: Date.now() - 500, fromMe: true });
    const cleared = (await as.query(api.comma.today.get, { day }))?.cleared.map((row) => row.conversationId);
    expect(cleared?.sort()).toEqual([c, other].sort());
  });
});
