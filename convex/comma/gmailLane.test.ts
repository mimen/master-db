import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { pendingGuid } from "../../apps/imsg/shared/pending-send";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import type { CommaOutboxPayload } from "../schema/comma/validators";
import { normalizeModules } from "../test-utils.vitest";

import { sealCredentials } from "./credentials";
import { FakeGmail, MAILBOX, parseRfc822, REFRESH_TOKEN, stubGmailEnv } from "./fakeGmail.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const SAM = "sam@venue.test";

let google: FakeGmail;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.now() });
  stubGmailEnv();
  google = new FakeGmail().install();
  google.accessTokens.push("ya29.seeded");
  google.on("GET", /\/users\/me\/settings\/sendAs$/, () => ({ body: { sendAs: [{ sendAsEmail: MAILBOX, displayName: "Milad Imen" }] } }));
  google.deliver({
    id: "m0", threadId: "t-doors", labelIds: ["SENT"], internalDate: Date.now() - 120_000, text: "Doors at 8?",
    headers: { From: `Milad <${MAILBOX}>`, To: `Sam Lee <${SAM}>`, Subject: "Doors", "Message-ID": "<milad-0@mail.test>" },
  });
  google.deliver({
    id: "m1", threadId: "t-doors", labelIds: ["INBOX", "UNREAD"], internalDate: Date.now() - 60_000, text: "Yes, 8 works.",
    headers: { From: `Sam Lee <${SAM}>`, To: MAILBOX, Cc: "pat@agency.test", Subject: "Re: Doors", "Message-ID": "<sam-1@venue.test>", References: "<milad-0@mail.test>" },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** One timer at a time, each function finished before the next fires. */
const settle = (t: { finishAllScheduledFunctions: (advance: () => void) => Promise<void> }) =>
  t.finishAllScheduledFunctions(() => vi.advanceTimersToNextTimer());

/** A connected mailbox whose history sync has read the doors thread. */
async function connected() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const credentials = await sealCredentials({ refreshToken: REFRESH_TOKEN, accessToken: "ya29.seeded", expiresAt: Date.now() + 3_600_000 }, `gmail:${MAILBOX}`);
  const accountId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("comma_accounts", {
      platform: "gmail", externalId: MAILBOX, label: MAILBOX, selfHandles: [MAILBOX], health: "ok", createdAt: 1, credentials,
    });
    await ctx.db.insert("comma_sync_state", { accountId: id, key: "gmail:history", cursor: "1000", updatedAt: 1 });
    return id;
  });
  await t.action(internal.comma.gmailSync.backstop, {});
  const conversation = (await t.run((ctx) => ctx.db.query("comma_conversations").collect())).find((row) => row.gmail?.threadId === "t-doors")!;
  const as = t.withIdentity({ subject: `${userId}|session` });
  const outbox = (clientKey: string) => t.run(async (ctx) => (await ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey)).unique())!);
  const run = async (clientKey: string, payload: CommaOutboxPayload) => {
    await as.mutation(api.comma.outbox.enqueue, { clientKey, conversationId: conversation._id, payload });
    await settle(t);
    return await outbox(clientKey);
  };
  const messages = () => t.run(async (ctx) => await ctx.db.query("comma_messages")
    .withIndex("by_conversation_date", (q) => q.eq("conversationId", conversation._id)).collect());
  const thread = () => t.run((ctx) => ctx.db.get(conversation._id as Id<"comma_conversations">));
  const state = () => t.run((ctx) => ctx.db.query("comma_conversation_state").withIndex("by_conversationId", (q) => q.eq("conversationId", conversation._id)).unique());
  const clears = () => t.run(async (ctx) => (await ctx.db.query("comma_triage_events").collect()).filter((row) => row.reason === "dismiss"));
  /** Gmail's history reports whatever changed since the last sync, as a push would. */
  const echo = async () => {
    await t.action(internal.comma.gmailSync.backstop, {});
    await settle(t);
  };
  return { t, as, accountId, conversationId: conversation._id, outbox, run, messages, thread, state, clears, echo };
}

const reply = (text: string, overrides: Partial<{ to: string[]; cc: string[]; subject: string }> = {}): CommaOutboxPayload => ({
  kind: "send", text, email: { to: [`Sam Lee <${SAM}>`], cc: [], subject: "Re: Doors", ...overrides },
});
const inThread = (threadId: string) => google.mail.filter((message) => message.threadId === threadId);

describe("sending email", () => {
  test("a reply threads in Gmail, lands from Gmail's answer in one write, and Gmail's own echo adds nothing", async () => {
    const { t, as, conversationId, run, messages, thread, echo } = await connected();
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "s1", conversationId, payload: reply("See you at 8.\nBring the rider.", { cc: ["pat@agency.test"] }) });
    expect((await messages()).map((row) => [row.guid, row.sendState])).toEqual([["m0", undefined], ["m1", undefined], [pendingGuid("s1"), "queued"]]);
    await settle(t);

    expect(google.sent).toHaveLength(1);
    expect(google.sent[0]!.threadId).toBe("t-doors");
    const { headers, parts } = parseRfc822(google.sent[0]!.raw);
    expect(headers).toMatchObject({
      From: `"Milad Imen" <${MAILBOX}>`, To: `"Sam Lee" <${SAM}>`, Cc: "pat@agency.test", Subject: "Re: Doors",
      "Message-ID": "<comma.s1@afternoonumbrellafriends.com>", "In-Reply-To": "<sam-1@venue.test>", References: "<milad-0@mail.test> <sam-1@venue.test>",
    });
    expect(parts["text/plain"]).toBe("See you at 8.\nBring the rider.");
    expect(parts["text/html"]).toBe('<div dir="ltr">See you at 8.<br>Bring the rider.</div>');
    expect(inThread("t-doors").map((message) => message.id)).toEqual(["m0", "m1", "sent-1"]);

    expect(await run("s1", reply("ignored"))).toMatchObject({ status: "sent", resultGuid: "sent-1" });
    const landed = await messages();
    expect(landed.map((row) => [row.guid, row.isFromMe, row.clientKey, row.text])).toEqual([
      ["m0", true, undefined, "Doors at 8?"], ["m1", false, undefined, "Yes, 8 works."], ["sent-1", true, "s1", "See you at 8.\nBring the rider."],
    ]);
    expect(landed[2]!.gmail).toMatchObject({ to: [{ address: SAM, name: "Sam Lee" }], cc: [{ address: "pat@agency.test", name: null }] });
    expect(await thread()).toMatchObject({ lastMessage: { guid: "sent-1", isFromMe: true } });

    await echo();
    expect((await messages()).map((row) => row.guid)).toEqual(["m0", "m1", "sent-1"]);
    expect(google.sent).toHaveLength(1);
  });

  test("a subject and a name beyond ASCII go out as RFC 2047 words and land as written", async () => {
    const { run, messages } = await connected();
    expect(await run("s2", reply("Merci", { subject: "Re: Café line-up", to: ["Zoë Ä <zoe@venue.test>"] }))).toMatchObject({ status: "sent" });
    const { headers } = parseRfc822(google.sent[0]!.raw);
    expect(headers.Subject).toBe(`=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode("Re: Café line-up")))}?=`);
    expect(headers.To).toMatch(/^=\?UTF-8\?B\?.+\?= <zoe@venue\.test>$/);
    expect((await messages()).slice(-1)[0]).toMatchObject({ subject: "Re: Café line-up", gmail: { to: [{ address: "zoe@venue.test", name: "Zoë Ä" }] } });
  });

  test("Convex refuses an email with no recipients, and reply suggestions for email, before anything queues", async () => {
    const { as, conversationId } = await connected();
    await expect(as.mutation(api.comma.outbox.enqueue, { clientKey: "n1", conversationId, payload: { kind: "send", text: "hi" } }))
      .rejects.toThrow("An email needs someone to send it to");
    await expect(as.mutation(api.comma.outbox.enqueue, { clientKey: "n2", conversationId, payload: { kind: "suggestions", model: "opus", refresh: false } }))
      .rejects.toThrow("Reply suggestions aren't on for email");
    expect(google.sent).toEqual([]);
  });

  test("Gmail refusing the send fails it, which the user may retry, and nothing is looked for", async () => {
    const { run, messages } = await connected();
    google.on("POST", /\/users\/me\/messages\/send$/, () => ({ status: 400, body: { error: { code: 400, status: "INVALID_ARGUMENT" } } }));
    expect(await run("f1", reply("hi"))).toMatchObject({ status: "failed", error: "Google answered 400: INVALID_ARGUMENT" });
    expect((await messages()).map((row) => row.sendState)).toEqual([undefined, undefined, "failed"]);
    expect(google.gmailCalls("/messages").filter((call) => call.method === "GET")).toEqual([]);
  });
});

describe("unknown sends", () => {
  /** Gmail takes the send, then its answer never arrives. */
  function loseSendAnswer(error: () => Error | Response) {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await google.fetch(input, init);
      if (String(input).endsWith("/messages/send")) {
        const lost = error();
        if (lost instanceof Response) return lost;
        throw lost;
      }
      return response;
    });
  }

  test("a send forced to time out after Gmail took it ends unknown, is found by its Message-ID, lands once and is never sent again", async () => {
    const { t, as, conversationId, outbox, messages } = await connected();
    loseSendAnswer(() => new DOMException("The operation timed out.", "TimeoutError"));
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "u1", conversationId, payload: reply("On my way") });
    vi.advanceTimersToNextTimer();
    await t.finishInProgressScheduledFunctions();
    expect(await outbox("u1")).toMatchObject({ status: "unknown" });
    expect((await messages()).map((row) => [row.guid, row.sendState])).toEqual([["m0", undefined], ["m1", undefined], [pendingGuid("u1"), "failed"]]);

    await settle(t);
    expect(await outbox("u1")).toMatchObject({ status: "sent", resultGuid: "sent-1" });
    expect((await outbox("u1")).error).toBeUndefined();
    expect((await messages()).map((row) => [row.guid, row.text, row.sendState])).toEqual([
      ["m0", "Doors at 8?", undefined], ["m1", "Yes, 8 works.", undefined], ["sent-1", "On my way", undefined],
    ]);
    expect(google.sent).toHaveLength(1);
    expect(google.gmailCalls("/messages").filter((call) => call.url.searchParams.get("q") === "rfc822msgid:comma.u1@afternoonumbrellafriends.com")).toHaveLength(1);
    await expect(as.mutation(api.comma.pendingSends.retrySend, { clientKey: "u1", retryKey: "u1-again" })).rejects.toThrow("Only a send that did not go out");
  });

  test("when Gmail replaced the Message-ID, the check finds the send in its thread by subject and text", async () => {
    const { run, messages } = await connected();
    google.replacesMessageId = true;
    loseSendAnswer(() => new Response("upstream", { status: 503 }));
    expect(await run("u2", reply("a & b"))).toMatchObject({ status: "sent", resultGuid: "sent-1" });
    expect((await messages()).map((row) => [row.text, row.isFromMe, row.sendState])).toEqual([
      ["Doors at 8?", true, undefined], ["Yes, 8 works.", false, undefined], ["a & b", true, undefined],
    ]);
    expect(google.sent).toHaveLength(1);
  });

  test("a send that never reached Gmail stays unknown after both checks, and nothing sends it", async () => {
    const { run, messages } = await connected();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/messages/send")) throw new TypeError("fetch failed");
      return await google.fetch(input, init);
    });
    expect(await run("u3", reply("lost"))).toMatchObject({ status: "unknown" });
    expect((await messages()).map((row) => row.sendState)).toEqual([undefined, undefined, "failed"]);
    expect(google.gmailCalls("/messages").filter((call) => call.url.searchParams.has("q"))).toHaveLength(2);
    expect(google.sent).toEqual([]);
  });

  test("the text check never takes a message another send already owns", async () => {
    const { t, as, conversationId, run, outbox } = await connected();
    google.replacesMessageId = true;
    expect(await run("ok1", reply("ok"))).toMatchObject({ status: "sent" });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/messages/send")) throw new TypeError("fetch failed");
      return await google.fetch(input, init);
    });
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "ok2", conversationId, payload: reply("ok") });
    await settle(t);
    expect((await outbox("ok2")).status).toBe("unknown");
  });
});

describe("archive from Comma", () => {
  test("settling archives in Gmail and counts as cleared once; the echo does nothing; unsettling unarchives", async () => {
    const { t, as, conversationId, thread, state, clears, echo } = await connected();
    await as.mutation(api.comma.triage.settle, { conversationId });
    expect((await state())?.dismissedUnrespondedGuid).toBe("m1");
    await settle(t);
    expect(inThread("t-doors").every((message) => !message.labelIds.includes("INBOX"))).toBe(true);
    expect((await thread())!.gmail).toMatchObject({ inInbox: false });

    const before = await state();
    await echo();
    expect(await state()).toEqual(before);
    expect((await clears()).map((event) => event.messageGuid)).toEqual(["m1"]);

    await as.mutation(api.comma.triage.unsettle, { conversationId });
    await settle(t);
    expect(inThread("t-doors").find((message) => message.id === "m1")!.labelIds).toContain("INBOX");
    expect((await thread())!.gmail).toMatchObject({ inInbox: true });
    const reopened = await state();
    await echo();
    expect(await state()).toEqual(reopened);
    expect(reopened?.dismissedUnrespondedGuid).toBeUndefined();
    expect(await clears()).toEqual([]);
  });

  test("a failed archive unsettles the thread and shows Gmail's error, which the next settle clears", async () => {
    const { t, as, conversationId, thread, state, clears } = await connected();
    google.on("POST", /\/threads\/[^/]+\/modify$/, () => ({ status: 403, body: { error: { code: 403, status: "PERMISSION_DENIED" } } }));
    await as.mutation(api.comma.triage.settle, { conversationId });
    await settle(t);
    expect((await state())?.dismissedUnrespondedGuid).toBeUndefined();
    expect(await clears()).toEqual([]);
    expect((await thread())!.gmail).toMatchObject({ inInbox: true, archiveError: "Gmail didn't archive this: Google answered 403: PERMISSION_DENIED" });
    const { page } = await as.query(api.comma.queries.listEmailThreads, { paginationOpts: { numItems: 10, cursor: null } });
    expect(page[0]).toMatchObject({ gmail: { archiveError: "Gmail didn't archive this: Google answered 403: PERMISSION_DENIED" }, flags: { unresponded: true } });

    google.on("POST", /\/threads\/[^/]+\/modify$/, (call) => {
      const threadId = decodeURIComponent(call.url.pathname.split("/").slice(-2)[0]!);
      google.relabel(threadId, { remove: ["INBOX"] });
      return { body: {} };
    });
    await as.mutation(api.comma.triage.settle, { conversationId });
    expect((await thread())!.gmail?.archiveError).toBeUndefined();
    await settle(t);
    expect((await thread())!.gmail).toMatchObject({ inInbox: false });
  });

  test("an archive queued for a non-mail conversation is refused", async () => {
    const { t, as } = await connected();
    const imessage = await t.run((ctx) => ctx.db.insert("comma_conversations", {
      platform: "imessage", conversationKey: "dm:+15550001", primaryChatGuid: "iMessage;-;+15550001", chatGuids: ["iMessage;-;+15550001"],
      kind: "dm", displayName: "Ana", isGroup: false, participants: [], isSpam: false, lastMessageAt: 1, updatedAt: 1,
    }));
    await expect(as.mutation(api.comma.outbox.enqueue, { clientKey: "a1", conversationId: imessage, payload: { kind: "archive" } })).rejects.toThrow("Only a mailbox archives");
  });
});
