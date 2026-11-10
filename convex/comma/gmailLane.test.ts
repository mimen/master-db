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
import { forwardSubject, forwardText, mailboxText, replyRecipients, replySubject } from "../../apps/imsg/shared/email-reply";

import { ALIAS, FakeGmail, MAILBOX, parseRfc822, REFRESH_TOKEN, stubGmailEnv } from "./fakeGmail.vitest";

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

describe("files, reply all and forward", () => {
  const store = (t: Awaited<ReturnType<typeof connected>>["t"], text: string, type: string) =>
    t.run(async (ctx) => await ctx.storage.store(new Blob([text], { type })));

  test("a reply with files goes out as multipart/mixed through the upload endpoint, and lands with them, once", async () => {
    const { t, run, messages } = await connected();
    const storageId = await store(t, "%PDF-1.7 rider", "application/pdf");
    const payload = reply("Rider attached.");
    if (payload.kind !== "send") throw new Error("a send");
    payload.email!.attachments = [{ storageId, filename: "Rider ü.pdf", mimeType: "application/pdf" }];
    expect(await run("a1", payload)).toMatchObject({ status: "sent", resultGuid: "sent-1" });

    expect(google.sent).toHaveLength(1);
    expect(google.sent[0]).toMatchObject({ upload: true, threadId: "t-doors" });
    const { headers, parts, files } = parseRfc822(google.sent[0]!.raw);
    expect(headers["Content-Type"]).toMatch(/^multipart\/mixed; boundary=/);
    expect(headers["In-Reply-To"]).toBe("<sam-1@venue.test>");
    expect(parts["text/plain"]).toBe("Rider attached.");
    expect(files).toEqual([{
      filename: "=?UTF-8?B?UmlkZXIgw7wucGRm?=", mimeType: "application/pdf", text: "%PDF-1.7 rider",
      disposition: `attachment; filename="=?UTF-8?B?UmlkZXIgw7wucGRm?="; filename*=UTF-8''Rider%20%C3%BC.pdf`,
    }]);

    const landed = (await messages()).slice(-1)[0]!;
    expect(landed.attachmentGuids).toEqual(["sent-1:1"]);
    const rows = await t.run((ctx) => ctx.db.query("comma_attachments").collect());
    expect(rows.map((row) => [row.guid, row.filename, row.originalStorageId])).toEqual([["sent-1:1", "Rider ü.pdf", storageId]]);
    // Gmail's echo of the send is already held, files and all.
    await t.action(internal.comma.gmailSync.backstop, {});
    await settle(t);
    expect((await t.run((ctx) => ctx.db.query("comma_attachments").collect())).length).toBe(1);
  });

  test("a text-only reply keeps the JSON send, and a file no longer stored fails the send before anything goes out", async () => {
    const { t, run } = await connected();
    expect(await run("a2", reply("No files."))).toMatchObject({ status: "sent" });
    expect(google.sent[0]!.upload).toBe(false);
    const storageId = await store(t, "gone", "text/plain");
    await t.run((ctx) => ctx.storage.delete(storageId));
    const payload = reply("Missing.");
    if (payload.kind !== "send") throw new Error("a send");
    payload.email!.attachments = [{ storageId, filename: "gone.txt", mimeType: "text/plain" }];
    expect(await run("a3", payload)).toMatchObject({ status: "failed", error: "gone.txt is no longer stored" });
    expect(google.sent).toHaveLength(1);
  });

  test("reply all goes To the sender and everyone on To, Cc its Cc, without the mailbox's own addresses, each once", async () => {
    google.deliver({
      id: "m2", threadId: "t-doors", labelIds: ["INBOX"], internalDate: Date.now() - 30_000, text: "Adding Dana.",
      headers: { From: `Sam Lee <${SAM}>`, To: `${MAILBOX}, Dana Ortiz <dana@venue.test>`, Cc: `pat@agency.test, ${ALIAS}, Sam Lee <${SAM}>`,
        Subject: "Re: Doors", "Message-ID": "<sam-2@venue.test>" },
    });
    const { t, as, accountId, run, messages } = await connected();
    await t.run((ctx) => ctx.db.patch(accountId, { selfHandles: [MAILBOX, ALIAS] }));
    const self = new Set((await as.query(api.comma.accounts.listAccounts, {})).find((account) => account._id === accountId)!.selfHandles);
    const source = (await messages()).find((row) => row.guid === "m2")!;
    const { to, cc } = replyRecipients({ isFromMe: source.isFromMe, ...source.gmail! }, "replyAll", self);
    expect(await run("ra1", { kind: "send", text: "All set.", replyToGuid: "m2",
      email: { to: to.map(mailboxText), cc: cc.map(mailboxText), subject: replySubject("Re: Doors") } })).toMatchObject({ status: "sent" });
    const { headers } = parseRfc822(google.sent[0]!.raw);
    expect(headers).toMatchObject({ To: `"Sam Lee" <${SAM}>, "Dana Ortiz" <dana@venue.test>`, Cc: "pat@agency.test", "In-Reply-To": "<sam-2@venue.test>" });
  });

  test("a forward starts a new thread from the same mailbox with the original quoted and its files, and the thread lands", async () => {
    google.deliver({
      id: "m-inv", threadId: "t-doors", labelIds: ["INBOX"], internalDate: Date.now() - 30_000, text: "Invoice for Saturday attached.",
      headers: { From: `Sam Lee <${SAM}>`, To: MAILBOX, Subject: "Re: Doors", "Message-ID": "<sam-inv@venue.test>" },
      files: [{ filename: "invoice.pdf", mimeType: "application/pdf", data: "%PDF invoice" }, { filename: "map.png", mimeType: "image/png", data: "PNG" }],
    });
    const { t, as, accountId, outbox, messages } = await connected();
    await settle(t);
    const original = (await messages()).find((row) => row.guid === "m-inv")!;
    const files = (await t.run((ctx) => ctx.db.query("comma_attachments").collect())).filter((row) => row.messageGuid === "m-inv" && row.filename === "invoice.pdf");
    const text = forwardText("Carlos, for the books.", { isFromMe: false, ...original.gmail!, date: original.dateCreated, subject: "Re: Doors", text: original.text }, "UTC");
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "fw1", payload: {
      kind: "sendEmail", accountId, text,
      email: { to: ["Carlos <carlos@books.test>"], cc: [], subject: forwardSubject("Re: Doors"),
        attachments: files.map((row) => ({ storageId: row.originalStorageId!, filename: row.filename!, mimeType: row.mimeType! })) },
    } });
    await settle(t);

    expect(google.sent).toHaveLength(1);
    expect(google.sent[0]).toMatchObject({ upload: true });
    expect(google.sent[0]!.threadId).toBeUndefined();
    const { headers, parts, files: sentFiles } = parseRfc822(google.sent[0]!.raw);
    expect(headers).toMatchObject({ From: `"Milad Imen" <${MAILBOX}>`, To: `"Carlos" <carlos@books.test>`, Subject: "Fwd: Re: Doors" });
    expect(headers["In-Reply-To"]).toBeUndefined();
    expect(parts["text/plain"]).toMatch(/^Carlos, for the books\.\n\n---------- Forwarded message ---------\nFrom: Sam Lee <sam@venue\.test>\nDate: .+\nSubject: Re: Doors\nTo: milad@afternoonumbrellafriends\.com\n\nInvoice for Saturday attached\.$/);
    expect(sentFiles.map((file) => [file.filename, file.text])).toEqual([["invoice.pdf", "%PDF invoice"]]);

    const row = await outbox("fw1");
    expect(row).toMatchObject({ status: "sent", resultGuid: "sent-1" });
    const forwarded = await t.run((ctx) => ctx.db.get(row.conversationId!));
    expect(forwarded).toMatchObject({ platform: "gmail", accountId, gmail: { threadId: "thread-sent-1", subject: "Fwd: Re: Doors" }, lastMessage: { guid: "sent-1", isFromMe: true } });
    const landed = await t.run(async (ctx) => (await ctx.db.query("comma_attachments").collect()).filter((a) => a.messageGuid === "sent-1"));
    expect(landed.map((a) => [a.filename, a.conversationId])).toEqual([["invoice.pdf", row.conversationId]]);
  });

  test("Convex refuses a new email with no recipients or from a mailbox that is not one", async () => {
    const { t, as, accountId } = await connected();
    const email = { to: [], cc: [], subject: "Hi" };
    await expect(as.mutation(api.comma.outbox.enqueue, { clientKey: "ne1", payload: { kind: "sendEmail", accountId, text: "hi", email } }))
      .rejects.toThrow("An email needs someone to send it to");
    const slack = await t.run((ctx) => ctx.db.insert("comma_accounts", { platform: "slack", externalId: "T1", label: "AUF", selfHandles: [], health: "ok", createdAt: 2 }));
    await expect(as.mutation(api.comma.outbox.enqueue, { clientKey: "ne2", payload: { kind: "sendEmail", accountId: slack, text: "hi", email: { ...email, to: ["a@b.test"] } } }))
      .rejects.toThrow("Choose a mailbox to send from");
    expect(google.sent).toEqual([]);
  });
});

describe("files over Gmail's 25 MB", () => {
  test("Convex refuses a reply or a new email whose files total over the limit, so the composer still holds them", async () => {
    const { t, as, accountId, conversationId } = await connected();
    const half = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(13 * 1024 * 1024)], { type: "application/pdf" })));
    const attachments = [{ storageId: half, filename: "a.pdf", mimeType: "application/pdf" }, { storageId: half, filename: "b.pdf", mimeType: "application/pdf" }];
    const email = { to: ["sam@venue.test"], cc: [], subject: "Files", attachments };
    await expect(as.mutation(api.comma.outbox.enqueue, { clientKey: "big1", conversationId, payload: { kind: "send", text: "hi", replyToGuid: "m1", email } }))
      .rejects.toThrow("The files are over Gmail's 25 MB limit");
    await expect(as.mutation(api.comma.outbox.enqueue, { clientKey: "big2", payload: { kind: "sendEmail", accountId, text: "hi", email } }))
      .rejects.toThrow("The files are over Gmail's 25 MB limit");
    expect(await t.run((ctx) => ctx.db.query("comma_outbox").collect())).toEqual([]);
  });
});

describe("rate-limited sends", () => {
  test("a send Gmail turns away for its rate limit goes out once the limit passes", async () => {
    const { run } = await connected();
    let refused = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/messages/send") && refused++ === 0) {
        // The retry waits inside the running action, which settle() never advances past; setImmediate is not faked.
        globalThis.setImmediate(() => vi.advanceTimersByTime(2_000));
        return Response.json({ error: { code: 403, status: "PERMISSION_DENIED", errors: [{ reason: "rateLimitExceeded" }] } }, { status: 403 });
      }
      return await google.fetch(input, init);
    });
    expect(await run("rl1", reply("hi"))).toMatchObject({ status: "sent" });
    expect(google.sent).toHaveLength(1);
  }, 15_000);
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

  test("a new email whose answer is lost is found by its Message-ID, lands as its thread once and is never sent again", async () => {
    const { t, as, accountId, outbox } = await connected();
    loseSendAnswer(() => new DOMException("The operation timed out.", "TimeoutError"));
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "n1", payload: {
      kind: "sendEmail", accountId, text: "Invoice attached.", email: { to: ["Carlos <carlos@books.test>"], cc: [], subject: "Invoice" },
    } });
    await settle(t);
    const row = await outbox("n1");
    expect(row).toMatchObject({ status: "sent", resultGuid: "sent-1", result: { kind: "sendEmail", guid: "sent-1" } });
    expect(row.error).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(row.conversationId!))).toMatchObject({
      platform: "gmail", accountId, gmail: { threadId: "thread-sent-1", subject: "Invoice" }, lastMessage: { guid: "sent-1" },
    });
    expect(google.sent).toHaveLength(1);
    expect(google.gmailCalls("/messages").filter((call) => call.url.searchParams.get("q") === "rfc822msgid:comma.n1@afternoonumbrellafriends.com")).toHaveLength(1);
  });

  test("a new email whose action died after Gmail took it is found by its Message-ID at its lease's expiry, and never sent again", async () => {
    const { t, accountId, outbox } = await connected();
    const now = Date.now();
    google.deliver({ id: "sent-9", threadId: "thread-sent-9", labelIds: ["SENT"], text: "Invoice attached.",
      headers: { From: MAILBOX, To: "carlos@books.test", Subject: "Invoice", "Message-ID": "<comma.n2@afternoonumbrellafriends.com>" } });
    await t.run((ctx) => ctx.db.insert("comma_outbox", { clientKey: "n2", lane: "gmail", status: "claimed", attempts: 1, leaseUntil: now - 1, claimToken: "dead",
      payload: { kind: "sendEmail", accountId, text: "Invoice attached.", email: { to: ["carlos@books.test"], cc: [], subject: "Invoice" } }, createdAt: now, updatedAt: now }));
    await t.mutation(internal.comma.outbox.claimOutbox, { now, leaseMs: 60_000, limit: 1, lane: "gmail" });
    await settle(t);
    expect(await outbox("n2")).toMatchObject({ status: "sent", resultGuid: "sent-9" });
    expect(google.sent).toHaveLength(0);
  });

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

  test("a reply that lands between the settle and the archive stays in the inbox, and the thread comes back", async () => {
    const { t, as, conversationId, thread, echo } = await connected();
    await as.mutation(api.comma.triage.settle, { conversationId });
    google.deliver({
      id: "m2", threadId: "t-doors", labelIds: ["INBOX", "UNREAD"], text: "Actually, can we do 9?",
      headers: { From: `Sam Lee <${SAM}>`, To: MAILBOX, Subject: "Re: Doors", "Message-ID": "<sam-2@venue.test>" },
    });
    await settle(t);
    expect(inThread("t-doors").map((message) => [message.id, message.labelIds.includes("INBOX")])).toEqual([["m0", false], ["m1", false], ["m2", true]]);
    await echo();
    expect((await thread())!.gmail).toMatchObject({ inInbox: true });
    const { page } = await as.query(api.comma.queries.listEmailThreads, { paginationOpts: { numItems: 10, cursor: null } });
    expect(page.find((row) => row._id === conversationId)).toMatchObject({ flags: { unresponded: true } });
  });

  test("a failed archive unsettles the thread and shows Gmail's error through a sync, until the next settle clears it", async () => {
    const { t, as, conversationId, thread, state, clears, echo } = await connected();
    google.on("POST", /\/messages\/batchModify$/, () => ({ status: 403, body: { error: { code: 403, status: "PERMISSION_DENIED" } } }));
    await as.mutation(api.comma.triage.settle, { conversationId });
    await settle(t);
    expect((await state())?.dismissedUnrespondedGuid).toBeUndefined();
    expect(await clears()).toEqual([]);
    expect((await thread())!.gmail).toMatchObject({ inInbox: true, archiveError: "Gmail didn't archive this: Google answered 403: PERMISSION_DENIED" });
    const { page } = await as.query(api.comma.queries.listEmailThreads, { paginationOpts: { numItems: 10, cursor: null } });
    expect(page[0]).toMatchObject({ gmail: { archiveError: "Gmail didn't archive this: Google answered 403: PERMISSION_DENIED" }, flags: { unresponded: true } });
    google.relabel("t-doors", { remove: ["UNREAD"] });
    await echo();
    expect((await thread())!.gmail?.archiveError, "a sync keeps the refusal on screen").toBe("Gmail didn't archive this: Google answered 403: PERMISSION_DENIED");

    google.on("POST", /\/messages\/batchModify$/, () => {
      google.relabel("t-doors", { remove: ["INBOX"] });
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

describe("two mailboxes", () => {
  const PERSONAL = "miladmaaan@gmail.com";

  /** The workspace mailbox from `connected`, and a gmail.com one holding the same thread under the same Gmail ids. */
  async function twoMailboxes() {
    const workspace = await connected();
    const { t } = workspace;
    const credentials = await sealCredentials({ refreshToken: REFRESH_TOKEN, accessToken: "ya29.seeded", expiresAt: Date.now() + 3_600_000 }, `gmail:${PERSONAL}`);
    const personalId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("comma_accounts", {
        platform: "gmail", externalId: PERSONAL, label: PERSONAL, selfHandles: [PERSONAL], health: "ok", createdAt: 2, credentials,
        gmailGrant: { app: "personal", grantedAt: Date.now() },
      });
      await ctx.db.insert("comma_sync_state", { accountId: id, key: "gmail:history", cursor: "1000", updatedAt: 1 });
      return id;
    });
    await t.action(internal.comma.gmailSync.backstop, {});
    const threads = await t.run(async (ctx) => (await ctx.db.query("comma_conversations").collect()).filter((row) => row.gmail?.threadId === "t-doors"));
    const personal = threads.find((row) => row.accountId === personalId)!;
    const personalMessages = () => t.run(async (ctx) => await ctx.db.query("comma_messages")
      .withIndex("by_conversation_date", (q) => q.eq("conversationId", personal._id)).collect());
    return { ...workspace, personalId, threads, personal, personalMessages };
  }

  test("each mailbox keeps its own thread for the same Gmail ids, and a reply goes out from the thread's mailbox", async () => {
    const { t, as, accountId, personalId, threads, personal, personalMessages, messages } = await twoMailboxes();
    expect(threads.map((row) => row.accountId).sort()).toEqual([accountId, personalId].sort());
    expect((await personalMessages()).map((row) => [row.guid, row.accountId])).toEqual([["m0", personalId], ["m1", personalId]]);
    expect((await messages()).map((row) => [row.guid, row.accountId])).toEqual([["m0", accountId], ["m1", accountId]]);

    await as.mutation(api.comma.outbox.enqueue, { clientKey: "p1", conversationId: personal._id, payload: reply("See you at 8.") });
    await settle(t);
    const { headers } = parseRfc822(google.sent[0]!.raw);
    expect(headers.From).toBe(PERSONAL);
    expect(headers["Message-ID"]).toBe("<comma.p1@gmail.com>");
    expect((await personalMessages()).map((row) => row.guid)).toEqual(["m0", "m1", "sent-1"]);
    expect((await messages()).map((row) => row.guid)).toEqual(["m0", "m1"]);
  });

  test("one mailbox failing in the backstop leaves the other syncing, and the run still reports the failure", async () => {
    const { t, accountId, personalMessages, messages } = await twoMailboxes();
    const unreadable = await sealCredentials({ refreshToken: REFRESH_TOKEN, accessToken: "x", expiresAt: 0 }, "gmail:someone-else");
    await t.run((ctx) => ctx.db.patch(accountId, { credentials: unreadable }));
    google.deliver({
      id: "m2", threadId: "t-doors", labelIds: ["INBOX"], internalDate: Date.now(), text: "Running late.",
      headers: { From: `Sam Lee <${SAM}>`, To: MAILBOX, Subject: "Re: Doors", "Message-ID": "<sam-2@venue.test>" },
    });
    await expect(t.action(internal.comma.gmailSync.backstop, {})).rejects.toThrow("1 mailbox(es) failed");
    expect((await personalMessages()).map((row) => row.guid)).toEqual(["m0", "m1", "m2"]);
    expect((await messages()).map((row) => row.guid)).toEqual(["m0", "m1"]);
  });
});
