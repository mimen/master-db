import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { pendingGuid } from "../../apps/imsg/shared/pending-send";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { sealCredentials } from "./credentials";
import { FakeGmail, MAILBOX, parseRfc822, REFRESH_TOKEN, stubGmailEnv } from "./fakeGmail.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const SAM = "sam@venue.test";
const HOUR = 3_600_000;

let google: FakeGmail;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.now() });
  stubGmailEnv();
  google = new FakeGmail().install();
  google.accessTokens.push("ya29.seeded");
  google.on("GET", /\/users\/me\/settings\/sendAs$/, () => ({ body: { sendAs: [{ sendAsEmail: MAILBOX, displayName: "Milad Imen" }] } }));
  google.deliver({
    id: "m1", threadId: "t-doors", labelIds: ["INBOX"], internalDate: Date.now() - 60_000, text: "Doors at 8?",
    headers: { From: `Sam Lee <${SAM}>`, To: MAILBOX, Subject: "Doors", "Message-ID": "<sam-1@venue.test>" },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Every job the scheduler holds, run in time order: the only actor once the user has scheduled. */
const settle = (t: { finishAllScheduledFunctions: (advance: () => void) => Promise<void> }) =>
  t.finishAllScheduledFunctions(() => vi.advanceTimersToNextTimer());

async function connected() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const credentials = await sealCredentials({ refreshToken: REFRESH_TOKEN, accessToken: "ya29.seeded", expiresAt: Date.now() + 24 * HOUR }, `gmail:${MAILBOX}`);
  await t.run(async (ctx) => {
    const id = await ctx.db.insert("comma_accounts", {
      platform: "gmail", externalId: MAILBOX, label: MAILBOX, selfHandles: [MAILBOX], health: "ok", createdAt: 1, credentials,
    });
    await ctx.db.insert("comma_sync_state", { accountId: id, key: "gmail:history", cursor: "1000", updatedAt: 1 });
  });
  await t.action(internal.comma.gmailSync.backstop, {});
  const conversationId = (await t.run((ctx) => ctx.db.query("comma_conversations").collect())).find((row) => row.gmail?.threadId === "t-doors")!._id;
  const as = t.withIdentity({ subject: `${userId}|session` });
  const schedule = (text: string, sendAt: number) => as.mutation(api.comma.scheduledSends.schedule, {
    conversationId, sendAt, payload: { kind: "send", text, replyToGuid: "m1", email: { to: [`Sam Lee <${SAM}>`], cc: [], subject: "Re: Doors" } },
  });
  const listed = () => as.query(api.comma.queries.listScheduled, {});
  const outbox = (scheduledId: Id<"comma_scheduled">) => t.run((ctx) => ctx.db.query("comma_outbox")
    .withIndex("by_clientKey", (q) => q.eq("clientKey", `scheduled-${scheduledId}`)).unique());
  const messages = () => t.run((ctx) => ctx.db.query("comma_messages").withIndex("by_conversation_date", (q) => q.eq("conversationId", conversationId)).collect());
  return { t, as, conversationId, schedule, listed, outbox, messages };
}

describe("a scheduled email", () => {
  test("goes out at its time through the Gmail lane with no client open, and lands in its thread", async () => {
    const { t, schedule, listed, outbox, messages } = await connected();
    const sendAt = Date.now() + HOUR;
    const id = await schedule("See you at 8.", sendAt);
    expect(await listed()).toMatchObject([{ _id: id, platform: "gmail", text: "See you at 8.", sendAt, status: "pending" }]);

    vi.advanceTimersByTime(HOUR - 60_000);
    await t.finishInProgressScheduledFunctions();
    expect(google.sent).toEqual([]);
    expect(await outbox(id)).toBeNull();

    await settle(t);
    expect(google.sent).toHaveLength(1);
    expect(Date.now()).toBeGreaterThanOrEqual(sendAt);
    const { headers, parts } = parseRfc822(google.sent[0]!.raw);
    expect(headers).toMatchObject({ To: `"Sam Lee" <${SAM}>`, Subject: "Re: Doors", "In-Reply-To": "<sam-1@venue.test>" });
    expect(parts["text/plain"]).toBe("See you at 8.");
    expect(await outbox(id)).toMatchObject({ status: "sent", resultGuid: "sent-1" });
    expect((await messages()).map((row) => [row.guid, row.text, row.sendState])).toEqual([["m1", "Doors at 8?", undefined], ["sent-1", "See you at 8.", undefined]]);
    expect(await listed()).toEqual([]);
  });

  test("cancelled before its time never sends, and a cancel after it went out says so", async () => {
    const { t, as, schedule, listed, outbox } = await connected();
    const id = await schedule("never", Date.now() + HOUR);
    await as.mutation(api.comma.scheduledSends.cancel, { scheduledId: id });
    expect(await listed()).toEqual([]);
    await settle(t);
    expect(google.sent).toEqual([]);
    expect(await outbox(id)).toBeNull();

    const late = await schedule("too late", Date.now() + HOUR);
    await settle(t);
    await expect(as.mutation(api.comma.scheduledSends.cancel, { scheduledId: late })).rejects.toThrow("It already went out");
    expect(google.sent).toHaveLength(1);
  });

  test("an edit moves its time and text: nothing goes at the old time, the new text goes once at the new one", async () => {
    const { t, as, schedule, listed, outbox } = await connected();
    const first = Date.now() + HOUR;
    const id = await schedule("draft", first);
    const moved = first + HOUR;
    await as.mutation(api.comma.scheduledSends.edit, { scheduledId: id, text: "Running late, 9 instead.", sendAt: moved });
    expect(await listed()).toMatchObject([{ _id: id, text: "Running late, 9 instead.", sendAt: moved, payload: { text: "Running late, 9 instead." } }]);

    vi.advanceTimersByTime(HOUR + 60_000);
    await t.finishInProgressScheduledFunctions();
    expect(google.sent).toEqual([]);
    expect(await outbox(id)).toBeNull();

    await settle(t);
    expect(google.sent).toHaveLength(1);
    expect(Date.now()).toBeGreaterThanOrEqual(moved);
    expect(parseRfc822(google.sent[0]!.raw).parts["text/plain"]).toBe("Running late, 9 instead.");
  });

  test("Send now queues it at once, and the job at its time finds nothing to send", async () => {
    const { t, as, schedule, outbox } = await connected();
    const id = await schedule("now please", Date.now() + HOUR);
    await as.mutation(api.comma.scheduledSends.sendNow, { scheduledId: id });
    await settle(t);
    expect(google.sent).toHaveLength(1);
    expect(await outbox(id)).toMatchObject({ status: "sent" });
  });

  test("Gmail refusing it at its time fails it like any send: a Not sent bubble the user may retry", async () => {
    const { t, as, schedule, outbox, messages } = await connected();
    const realSend = vi.fn();
    let refusing = true;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (refusing && String(input).endsWith("/messages/send")) return Response.json({ error: { code: 400, status: "INVALID_ARGUMENT" } }, { status: 400 });
      if (String(input).endsWith("/messages/send")) realSend();
      return await google.fetch(input, init);
    });
    const id = await schedule("refused", Date.now() + HOUR);
    await settle(t);
    expect(await outbox(id)).toMatchObject({ status: "failed", error: "Google answered 400: INVALID_ARGUMENT" });
    expect((await messages()).map((row) => [row.guid, row.sendState])).toEqual([["m1", undefined], [pendingGuid(`scheduled-${id}`), "failed"]]);

    refusing = false;
    await as.mutation(api.comma.pendingSends.retrySend, { clientKey: `scheduled-${id}`, retryKey: "again" });
    await settle(t);
    expect(realSend).toHaveBeenCalledOnce();
    expect(google.sent).toHaveLength(1);
  });

  test("an answer lost after Gmail took it ends unknown like any send, is found by its Message-ID and never sent twice", async () => {
    const { t, schedule, outbox, messages } = await connected();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await google.fetch(input, init);
      if (String(input).endsWith("/messages/send")) throw new DOMException("The operation timed out.", "TimeoutError");
      return response;
    });
    const id = await schedule("lost answer", Date.now() + HOUR);
    vi.advanceTimersByTime(HOUR);
    await t.finishInProgressScheduledFunctions();
    vi.advanceTimersToNextTimer();
    await t.finishInProgressScheduledFunctions();
    expect(await outbox(id)).toMatchObject({ status: "unknown" });

    await settle(t);
    expect(await outbox(id)).toMatchObject({ status: "sent", resultGuid: "sent-1" });
    expect((await messages()).map((row) => row.text)).toEqual(["Doors at 8?", "lost answer"]);
    expect(google.sent).toHaveLength(1);
  });

  test("a send refused when it comes due stays on the list as Not sent with the reason", async () => {
    const { t, conversationId, schedule, listed } = await connected();
    const id = await schedule("orphan", Date.now() + HOUR);
    await t.run((ctx) => ctx.db.delete(conversationId));
    await settle(t);
    expect(await listed()).toMatchObject([{ _id: id, status: "failed", error: "Conversation not found" }]);
    expect(google.sent).toEqual([]);
  });
});

describe("what Comma refuses to schedule", () => {
  test("an iMessage conversation, which BlueBubbles schedules, and an email with no recipients", async () => {
    const { t, as, conversationId } = await connected();
    const dm = await t.run((ctx) => ctx.db.insert("comma_conversations", {
      platform: "imessage", conversationKey: "dm:+15550001111", kind: "dm", displayName: "Sam", isGroup: false,
      participants: [{ address: "+15550001111", name: null }], isSpam: false, lastMessageAt: 1, updatedAt: 1, chatGuids: ["iMessage;-;+15550001111"],
    }));
    await expect(as.mutation(api.comma.scheduledSends.schedule, { conversationId: dm, sendAt: Date.now() + HOUR, payload: { kind: "send", text: "hi" } }))
      .rejects.toThrow("iMessage schedules through BlueBubbles");
    await expect(as.mutation(api.comma.scheduledSends.schedule, { conversationId, sendAt: Date.now() + HOUR, payload: { kind: "send", text: "hi" } }))
      .rejects.toThrow("An email needs someone to send it to");
  });

  test("an iMessage row's edit, cancel or send now, which go to BlueBubbles", async () => {
    const { t, as } = await connected();
    const bb = await t.run((ctx) => ctx.db.insert("comma_scheduled", { bbId: 7, chatGuid: "iMessage;-;+15550001111", text: "hi", sendAt: 5, status: "pending", updatedAt: 1 }));
    await expect(as.mutation(api.comma.scheduledSends.cancel, { scheduledId: bb })).rejects.toThrow("BlueBubbles sends this one");
    await expect(as.mutation(api.comma.scheduledSends.sendNow, { scheduledId: bb })).rejects.toThrow("BlueBubbles sends this one");
    expect(await t.run((ctx) => ctx.db.get(bb))).not.toBeNull();
  });
});
