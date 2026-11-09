import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import { NOT_SENT_AFTER_MS, NOT_SENT_ERROR } from "../../apps/imsg/shared/pending-send";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
type T = TestConvex<typeof schema>;

afterEach(() => {
  vi.useRealTimers();
});

async function setup(primaryChatGuid = "iMessage;-;+15550001111") {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const c = await t.run((ctx) => ctx.db.insert("comma_conversations", {
    conversationKey: "dm:+15550001111", primaryChatGuid, chatGuids: [primaryChatGuid], displayName: "Alex", isGroup: false,
    participants: [], lastMessageAt: 1, isSpam: false, hasGroupPhoto: false, updatedAt: 1,
    lastMessage: { guid: "earlier", text: "earlier", dateCreated: 1, isFromMe: false, senderName: null, hasAttachments: false },
  }));
  await t.run((ctx) => ctx.db.insert("comma_messages", {
    guid: "earlier", conversationId: c, chatGuid: primaryChatGuid, dateCreated: 1, isFromMe: false, text: "earlier", service: "iMessage",
    error: 0, edited: false, retracted: false, isTapback: false, reactions: [], isGroupEvent: false, mentions: [], attachmentGuids: [], sourceVersion: 1,
  }));
  return { t, as: t.withIdentity({ subject: `${userId}|session` }), c };
}

const send = (as: ReturnType<T["withIdentity"]>, c: Id<"comma_conversations">, reply = true) =>
  as.mutation(api.comma.outbox.enqueue, { clientKey: "k", conversationId: c, payload: { kind: "send", text: "hello", ...(reply ? { replyToGuid: "earlier" } : {}) } });

const state = (t: T) => t.run(async (ctx) => ({
  bubbles: (await ctx.db.query("comma_messages").collect()).filter((m) => m.isFromMe).map((m) => [m.guid, m.sendState ?? null]),
  outbox: (await ctx.db.query("comma_outbox").collect()).map((r) => [r.clientKey, r.status]),
  last: (await ctx.db.query("comma_conversations").first())?.lastMessage?.guid,
}));

describe("a pending send", () => {
  test("shows queued, then sending once the bridge claims it", async () => {
    const { t, as, c } = await setup();
    await send(as, c);
    expect(await state(t)).toEqual({ bubbles: [["temp-k", "queued"]], outbox: [["k", "pending"]], last: "temp-k" });
    await t.mutation(internal.comma.outbox.claimOutbox, { now: Date.now(), leaseMs: 1000, limit: 10, lane: "imessage" });
    expect((await state(t)).bubbles).toEqual([["temp-k", "sending"]]);
  });

  test.each([
    ["iMessage;-;+15550001111", "iMessage"],
    ["SMS;-;+15550001111", "SMS"],
    ["RCS;-;+15550001111", "SMS"],
  ])("routed through %s shows as %s", async (chatGuid, service) => {
    const { t, as, c } = await setup(chatGuid);
    await send(as, c, false);
    const bubble = await t.run((ctx) => ctx.db.query("comma_messages").withIndex("by_guid", (q) => q.eq("guid", "temp-k")).unique());
    expect(bubble).toMatchObject({ imessage: { chatGuid, service } });
  });

  test("a failed or unknown outcome strands it as failed", async () => {
    const { t, as, c } = await setup();
    await send(as, c);
    const [claim] = await t.mutation(internal.comma.outbox.claimOutbox, { now: Date.now(), leaseMs: 1000, limit: 10, lane: "imessage" });
    await t.mutation(internal.comma.outbox.completeOutbox, { clientKey: "k", claimToken: claim!.claimToken!, status: "unknown" });
    const [bubble] = await t.run((ctx) => ctx.db.query("comma_messages").withIndex("by_guid", (q) => q.eq("guid", "temp-k")).collect());
    expect(bubble).toMatchObject({ sendState: "failed", imessage: { error: 1 } });
  });
});

describe("Not sent", () => {
  test("a send nothing took in time fails as Not sent and the bridge never claims it", async () => {
    vi.useFakeTimers();
    const { t, as, c } = await setup();
    await send(as, c);
    vi.advanceTimersByTime(NOT_SENT_AFTER_MS);
    await t.finishInProgressScheduledFunctions();
    expect(await state(t)).toEqual({ bubbles: [["temp-k", "notSent"]], outbox: [["k", "failed"]], last: "temp-k" });
    expect(await t.mutation(internal.comma.outbox.claimOutbox, { now: Date.now(), leaseMs: 1000, limit: 10, lane: "imessage" })).toEqual([]);
    const row = await t.run((ctx) => ctx.db.query("comma_outbox").first());
    expect(row?.error).toBe(NOT_SENT_ERROR);
  });

  test("a claim after the window expires the send instead of sending it, even before the scheduled expiry runs", async () => {
    const { t, as, c } = await setup();
    await send(as, c);
    const claimed = await t.mutation(internal.comma.outbox.claimOutbox, { now: Date.now() + NOT_SENT_AFTER_MS, leaseMs: 1000, limit: 10, lane: "imessage" });
    expect(claimed).toEqual([]);
    expect((await state(t)).bubbles).toEqual([["temp-k", "notSent"]]);
  });

  test("a send the bridge took in time is left alone by the expiry", async () => {
    vi.useFakeTimers();
    const { t, as, c } = await setup();
    await send(as, c);
    await t.mutation(internal.comma.outbox.claimOutbox, { now: Date.now(), leaseMs: NOT_SENT_AFTER_MS * 2, limit: 10, lane: "imessage" });
    vi.advanceTimersByTime(NOT_SENT_AFTER_MS);
    await t.finishInProgressScheduledFunctions();
    expect(await state(t)).toEqual({ bubbles: [["temp-k", "sending"]], outbox: [["k", "claimed"]], last: "temp-k" });
  });
});

describe("Not sent, for the sends that draw no pending row", () => {
  const attachment = (t: T) => t.run((ctx) => ctx.storage.store(new Blob(["photo"], { type: "image/jpeg" })));

  test("an attachment nothing took in time fails as Not sent instead of going out when the Mini comes back", async () => {
    vi.useFakeTimers();
    const { t, as, c } = await setup();
    const storageId = await attachment(t);
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "a", conversationId: c, payload: { kind: "sendAttachment", storageId, filename: "photo.jpg", mimeType: "image/jpeg", isAudioMessage: false } });
    vi.advanceTimersByTime(NOT_SENT_AFTER_MS);
    await t.finishInProgressScheduledFunctions();
    expect((await state(t)).outbox).toEqual([["a", "failed"]]);
    expect(await t.mutation(internal.comma.outbox.claimOutbox, { now: Date.now(), leaseMs: 1000, limit: 10, lane: "imessage" })).toEqual([]);
  });

  test("a new chat claimed after the window is expired, not created", async () => {
    const { t, as } = await setup();
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "n", payload: { kind: "createChat", addresses: ["+15550002222"], text: "hi" } });
    expect(await t.mutation(internal.comma.outbox.claimOutbox, { now: Date.now() + NOT_SENT_AFTER_MS, leaseMs: 1000, limit: 10, lane: "imessage" })).toEqual([]);
    const row = await t.run((ctx) => ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", "n")).unique());
    expect(row).toMatchObject({ status: "failed", error: NOT_SENT_ERROR });
  });
});

describe("cancelSend", () => {
  test("removes a queued send's bubble and outbox row and gives the preview back", async () => {
    const { t, as, c } = await setup();
    await send(as, c);
    expect(await as.mutation(api.comma.pendingSends.cancelSend, { clientKey: "k" })).toBe(true);
    expect(await state(t)).toEqual({ bubbles: [], outbox: [], last: "earlier" });
    expect(await t.mutation(internal.comma.outbox.claimOutbox, { now: Date.now(), leaseMs: 1000, limit: 10, lane: "imessage" })).toEqual([]);
  });

  test("refuses once the bridge has the send", async () => {
    const { t, as, c } = await setup();
    await send(as, c);
    await t.mutation(internal.comma.outbox.claimOutbox, { now: Date.now(), leaseMs: 1000, limit: 10, lane: "imessage" });
    expect(await as.mutation(api.comma.pendingSends.cancelSend, { clientKey: "k" })).toBe(false);
    expect((await state(t)).outbox).toEqual([["k", "claimed"]]);
  });

  test("discards a send that did not go out: its bubble goes and the preview comes back", async () => {
    const { t, as, c } = await setup();
    await send(as, c);
    const [claim] = await t.mutation(internal.comma.outbox.claimOutbox, { now: Date.now(), leaseMs: 1000, limit: 10, lane: "imessage" });
    await t.mutation(internal.comma.outbox.completeOutbox, { clientKey: "k", claimToken: claim!.claimToken!, status: "failed", error: "offline" });
    expect(await as.mutation(api.comma.pendingSends.cancelSend, { clientKey: "k" })).toBe(true);
    expect(await state(t)).toEqual({ bubbles: [], outbox: [], last: "earlier" });
  });

  test("a send that never reached Convex has nothing to cancel", async () => {
    const { as } = await setup();
    expect(await as.mutation(api.comma.pendingSends.cancelSend, { clientKey: "never" })).toBe(true);
  });

  test("requires Convex Auth", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.comma.pendingSends.cancelSend, { clientKey: "k" })).rejects.toThrow();
  });
});

describe("retrySend", () => {
  test("replaces a Not sent bubble with a new queued send of the same message", async () => {
    const { t, as, c } = await setup();
    await send(as, c);
    await t.mutation(internal.comma.outbox.claimOutbox, { now: Date.now() + NOT_SENT_AFTER_MS, leaseMs: 1000, limit: 10, lane: "imessage" });
    const first = await as.mutation(api.comma.pendingSends.retrySend, { clientKey: "k", retryKey: "k2" });
    const again = await as.mutation(api.comma.pendingSends.retrySend, { clientKey: "k", retryKey: "k2" });
    expect(again).toBe(first);
    expect(await state(t)).toEqual({ bubbles: [["temp-k2", "queued"]], outbox: [["k", "failed"], ["k2", "pending"]], last: "temp-k2" });
    const retried = await t.run((ctx) => ctx.db.get(first));
    expect(retried?.payload).toEqual({ kind: "send", text: "hello", replyToGuid: "earlier" });
  });

  test("never resends a send that is still queued, on its way, or sent", async () => {
    const { t, as, c } = await setup();
    await send(as, c);
    await expect(as.mutation(api.comma.pendingSends.retrySend, { clientKey: "k", retryKey: "k2" })).rejects.toThrow("can be retried");
    const [claim] = await t.mutation(internal.comma.outbox.claimOutbox, { now: Date.now(), leaseMs: 1000, limit: 10, lane: "imessage" });
    await expect(as.mutation(api.comma.pendingSends.retrySend, { clientKey: "k", retryKey: "k2" })).rejects.toThrow("can be retried");
    await t.mutation(internal.comma.outbox.completeOutbox, { clientKey: "k", claimToken: claim!.claimToken!, status: "sent" });
    await expect(as.mutation(api.comma.pendingSends.retrySend, { clientKey: "k", retryKey: "k2" })).rejects.toThrow("can be retried");
    expect((await state(t)).outbox).toEqual([["k", "sent"]]);
  });
});

describe("settle anchoring", () => {
  test("a settle taken on a queued send holds once that send lands under its real guid", async () => {
    const { t, as, c } = await setup();
    await send(as, c);
    const [claim] = await t.mutation(internal.comma.outbox.claimOutbox, { now: Date.now(), leaseMs: 1000, limit: 10, lane: "imessage" });
    await as.mutation(api.comma.triage.settle, { conversationId: c, anchor: "temp-k" });
    await t.mutation(internal.comma.internal.upsertMessages, { messages: [{
      guid: "REAL", conversationId: c, chatGuid: "iMessage;-;+15550001111", dateCreated: Date.now(), isFromMe: true, text: "hello",
      service: "iMessage", error: 0, edited: false, retracted: false, isTapback: false, reactions: [], isGroupEvent: false,
      mentions: [], attachmentGuids: [], sourceVersion: 1000,
    }] });
    await t.mutation(internal.comma.outbox.completeOutbox, { clientKey: "k", claimToken: claim!.claimToken!, status: "sent", resultGuid: "REAL" });
    const triage = await t.run((ctx) => ctx.db.query("comma_conversation_state").first());
    expect(triage?.dismissedWaitingGuid).toBe("REAL");
    expect((await state(t)).bubbles).toEqual([["REAL", null]]);
  });
});
