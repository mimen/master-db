import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import crons from "../crons";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { ALIAS, FakeGmail, MAILBOX, PUSH_TOPIC, pushBody, stubGmailEnv, type FakeMail } from "./fakeGmail.vitest";
import { GMAIL_SCOPES } from "./googleAuth";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const DAY = 86_400_000;
const SAM = "sam@example.com";

let google: FakeGmail;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.now() });
  stubGmailEnv();
  google = new FakeGmail().install();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const inbound = (id: string, threadId: string, from: string, overrides: Partial<FakeMail> & { subject?: string } = {}): Omit<FakeMail, "internalDate"> => ({
  id, threadId, labelIds: ["INBOX", "UNREAD"],
  headers: { From: from, To: MAILBOX, Subject: overrides.subject ?? `About ${threadId}`, ...overrides.headers },
  text: `Hello from ${threadId}`, ...overrides,
});

/** Sam is a person Comma knows, by an iMessage handle that is his email. */
async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) => {
    const person = await ctx.db.insert("people", {
      display_name: "Sam Lee", normalized_phones: [], normalized_emails: [SAM], identity_count: 1, message_count: 0,
      is_self: false, auto_clustered: false, created_at: "x", updated_at: "x",
    });
    await ctx.db.insert("identities", { person_id: person, kind: "imessage", value: SAM, normalized: SAM, source: "manual",
      is_self: false, message_count: 0, chat_count: 0, created_at: "x", updated_at: "x" });
    return await ctx.db.insert("users", { email: ALLOWED_EMAIL });
  });
  return { t, as: t.withIdentity({ subject: `${userId}|session` }) };
}
type T = Awaited<ReturnType<typeof setup>>["t"];
type As = Awaited<ReturnType<typeof setup>>["as"];

/**
 * Runs scheduled functions one at a time. convex-test 0.0.38 lets an action's storage.store write into whichever
 * transaction another concurrently running function holds, so two at once (a backfill and a file download) can
 * drop a download. Ends once no job is pending: a job whose timer fired stays pending until its callback starts.
 */
async function settle(t: T): Promise<void> {
  for (let round = 0; round < 200; round++) {
    await t.finishAllScheduledFunctions(() => vi.advanceTimersToNextTimer());
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    if (!jobs.some((job) => job.state.kind === "pending" || job.state.kind === "inProgress")) return;
  }
}

/** Settings' Connect through Google's consent; connecting starts the backfill and the watch, run to the end here. */
async function connect(t: T, as: As) {
  const authorize = new URL(await as.action(api.comma.googleAuth.startGmailConnect, {}));
  const [stored] = await t.run((ctx) => ctx.db.query("comma_oauth_states").collect());
  google.codes.set("code", { verifier: stored!.verifier, scope: GMAIL_SCOPES.join(" ") });
  await t.fetch(`/comma/oauth/google/callback?code=code&state=${authorize.searchParams.get("state")}`, { method: "GET" });
  await settle(t);
  return (await t.run((ctx) => ctx.db.query("comma_accounts").withIndex("by_platform_externalId", (q) => q.eq("platform", "gmail")).unique()))!;
}

const threads = (t: T) => t.run(async (ctx) => (await ctx.db.query("comma_conversations").collect()).filter((row) => row.platform === "gmail"));
const thread = async (t: T, threadId: string) => (await threads(t)).find((row) => row.gmail?.threadId === threadId);
const stateOf = (t: T, conversationId: string) => t.run((ctx) => ctx.db.query("comma_conversation_state").collect())
  .then((rows) => rows.find((row) => row.conversationId === conversationId));
const clears = (t: T) => t.run((ctx) => ctx.db.query("comma_triage_events").collect()).then((rows) => rows.filter((row) => row.reason === "dismiss"));
const fullReads = (threadId: string) => google.gmailCalls(`/threads/${threadId}`).filter((call) => call.url.searchParams.get("format") === "full");

const push = async (t: T, token?: string, body = pushBody()) =>
  await t.fetch("/comma/gmail/push", { method: "POST", body, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

/** A mailbox: Sam's reply with a script and a tracking pixel, a newsletter, a stranger, and archived mail. */
function seedMailbox() {
  google.pageSize = 2;
  google.deliver(inbound("m1", "t-sam", `Sam Lee <${SAM}>`, {
    subject: "Doors", text: "Yes, 8 works.\n\nOn Fri Milad wrote:\n> Doors at 8?",
    html: '<div>Yes, 8 works.<img src="https://track.test/o.gif" width="1" height="1"><script>alert(1)</script></div><div class="gmail_quote">Doors at 8?</div>',
    internalDate: Date.now() - 2 * DAY,
  }));
  google.deliver(inbound("m2", "t-news", "AUF Weekly <news@list.test>", { headers: { "List-Unsubscribe": "<https://list.test/u>" }, snippet: "This week &amp; more" }));
  google.deliver(inbound("m3", "t-stranger", "Pat <pat@nowhere.test>", { internalDate: Date.now() - DAY }));
  google.deliver(inbound("m4", "t-old-sam", `Sam Lee <${SAM}>`, { labelIds: [], internalDate: Date.now() - 10 * DAY }));
  google.deliver(inbound("m5", "t-old-stranger", "Lee <lee@nowhere.test>", { labelIds: [], internalDate: Date.now() - 10 * DAY }));
  google.deliver(inbound("m6", "t-ancient-sam", `Sam Lee <${SAM}>`, { labelIds: [], internalDate: Date.now() - 120 * DAY }));
}

describe("the backfill", () => {
  test("reads the inbox and 90 days of threads with people, across pages, and settles archived ones quietly", async () => {
    seedMailbox();
    const { t, as } = await setup();
    await connect(t, as);
    const kept = (await threads(t)).map((row) => row.gmail!.threadId).sort();
    expect(kept).toEqual(["t-news", "t-old-sam", "t-sam", "t-stranger"]);
    expect(google.gmailCalls("/threads").filter((call) => call.url.pathname.endsWith("/threads")).length).toBeGreaterThan(2);
    const archived = (await thread(t, "t-old-sam"))!;
    expect(archived.gmail).toMatchObject({ inInbox: false, bulk: false });
    expect((await stateOf(t, archived._id))?.dismissedUnrespondedGuid).toBe("m4");
    // Nothing the backfill found counts as cleared today.
    expect(await clears(t)).toEqual([]);
    expect((await stateOf(t, (await thread(t, "t-sam"))!._id))?.dismissedUnrespondedGuid).toBeUndefined();
  });

  test("a page whose read fails once is read again, and the backfill still finishes", async () => {
    seedMailbox();
    let dropped = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (/\/threads\/t-sam\b/.test(String(input)) && dropped++ === 0) throw new TypeError("error decoding response body");
      return await google.fetch(input, init);
    });
    const { t, as } = await setup();
    await connect(t, as);
    expect(dropped).toBeGreaterThan(1);
    expect((await threads(t)).map((row) => row.gmail!.threadId).sort()).toEqual(["t-news", "t-old-sam", "t-sam", "t-stranger"]);
  });

  test("a person's mail keeps its subject, thread and new content for models, and its HTML cleaned", async () => {
    seedMailbox();
    const { t, as } = await setup();
    await connect(t, as);
    const [message] = await t.run((ctx) => ctx.db.query("comma_messages").filter((q) => q.eq(q.field("guid"), "m1")).collect());
    expect(message).toMatchObject({
      platform: "gmail", isFromMe: false, sender: { address: SAM, name: "Sam Lee" }, subject: "Doors", threadRef: "t-sam", modelText: "Yes, 8 works.",
      gmail: { from: { address: SAM, name: "Sam Lee" }, to: [{ address: MAILBOX, name: null }], bulk: false },
    });
    expect(message!.text).toContain("Doors at 8?");
    expect(message!.gmail!.html).toContain("Yes, 8 works.");
    expect(message!.gmail!.html).not.toMatch(/script|alert|track\.test/);
    expect((await thread(t, "t-sam"))).toMatchObject({ kind: "emailThread", isGroup: true, participants: [{ address: SAM, name: null }],
      gmail: { subject: "Doors", inInbox: true, bulk: false }, lastMessage: { guid: "m1", isFromMe: false } });
  });

  test("a newsletter is bulk, read as headers only, and makes no identity", async () => {
    seedMailbox();
    const { t, as } = await setup();
    await connect(t, as);
    expect((await thread(t, "t-news"))!.gmail).toMatchObject({ bulk: true, inInbox: true });
    expect(fullReads("t-news")).toEqual([]);
    expect(fullReads("t-sam").length).toBe(1);
    const [news] = await t.run((ctx) => ctx.db.query("comma_messages").filter((q) => q.eq(q.field("guid"), "m2")).collect());
    expect(news).toMatchObject({ text: "This week & more", gmail: { bulk: true } });
    expect(news!.gmail!.html).toBeUndefined();
    const identities = await t.run((ctx) => ctx.db.query("identities").withIndex("by_kind_normalized", (q) => q.eq("kind", "email")).collect());
    expect(identities.map((identity) => identity.normalized).sort()).toEqual(["pat@nowhere.test", SAM]);
  });

  test("a sender is an email identity, joined to the person with exactly that address; a stranger stays unlinked", async () => {
    seedMailbox();
    const { t, as } = await setup();
    await connect(t, as);
    const email = await t.run((ctx) => ctx.db.query("identities").withIndex("by_kind_normalized", (q) => q.eq("kind", "email")).collect());
    const sam = await t.run((ctx) => ctx.db.query("people").first());
    expect(email.find((identity) => identity.normalized === SAM)).toMatchObject({ person_id: sam!._id, display_name: "Sam Lee", source: "gmail" });
    expect(email.find((identity) => identity.normalized === "pat@nowhere.test")?.person_id).toBeUndefined();
  });

  test("runs again without writing anything twice", async () => {
    seedMailbox();
    const { t, as } = await setup();
    const account = await connect(t, as);
    const before = await t.run((ctx) => ctx.db.query("comma_messages").collect());
    await t.action(internal.comma.gmailSync.startBackfill, { accountId: account._id, resync: false });
    await settle(t);
    expect(await t.run((ctx) => ctx.db.query("comma_messages").collect())).toHaveLength(before.length);
    expect(await threads(t)).toHaveLength(4);
    expect(await clears(t)).toEqual([]);
  });

  test("email stays out of the Messages list; Today takes only the People lens, a known sender owed a reply", async () => {
    seedMailbox();
    const { t, as } = await setup();
    await connect(t, as);
    const listed = await as.query(api.comma.queries.listConversations, { paginationOpts: { numItems: 50, cursor: null } });
    expect(listed.page).toEqual([]);
    const sam = (await thread(t, "t-sam"))!;
    const candidates = async () => (await t.mutation(internal.comma.today.todayCandidates, { cursor: null, numItems: 50 })).page;
    expect((await candidates()).map((row) => [row.conversationId, row.platform, row.state, row.unreadCount])).toEqual([[sam._id, "gmail", "needsYou", 1]]);

    google.relabel("t-sam", { remove: ["INBOX"] });
    await push(t, await google.oidcToken());
    await settle(t);
    expect(await candidates()).toEqual([]);
  });

  test("a thread is unread while Gmail labels a message UNREAD; reading it in Gmail clears it", async () => {
    seedMailbox();
    const { t, as } = await setup();
    await connect(t, as);
    const sam = (await thread(t, "t-sam"))!;
    const view = () => as.query(api.comma.queries.getConversation, { conversationId: sam._id });
    expect(await view()).toMatchObject({ unreadCount: 1, flags: { unread: true } });
    google.relabel("t-sam", { remove: ["UNREAD"] });
    await push(t, await google.oidcToken());
    await settle(t);
    expect(await view()).toMatchObject({ unreadCount: 0, flags: { unread: false } });
  });
});

describe("Gmail push", () => {
  test("a push with Google's token for the subscription's service account lands new mail at once", async () => {
    const { t, as } = await setup();
    await connect(t, as);
    google.deliver(inbound("m7", "t-new", `Sam Lee <${SAM}>`, { subject: "Tonight" }));
    const response = await push(t, await google.oidcToken());
    expect(response.status).toBe(204);
    await settle(t);
    expect((await thread(t, "t-new"))).toMatchObject({ gmail: { subject: "Tonight", inInbox: true }, lastMessage: { guid: "m7" } });
    const [status] = await t.run((ctx) => ctx.db.query("comma_bridge_state").collect());
    expect(status).toMatchObject({ connected: true, capabilities: { executor: "gmail" } });
  });

  test("refuses a missing, forged, expired or misaddressed token before reading anything", async () => {
    const { t, as } = await setup();
    await connect(t, as);
    google.deliver(inbound("m7", "t-new", `Sam Lee <${SAM}>`));
    const forger = new FakeGmail();
    const refused = [
      undefined,
      "not.a.jwt",
      await google.oidcToken({}, forger),
      await google.oidcToken({ aud: "https://elsewhere.test/comma/gmail/push" }),
      await google.oidcToken({ email: "someone@else.iam.gserviceaccount.com" }),
      await google.oidcToken({ email_verified: false }),
      await google.oidcToken({ iss: "https://evil.test" }),
      await google.oidcToken({ exp: Math.floor(Date.now() / 1000) - 3600 }),
    ];
    for (const token of refused) expect((await push(t, token)).status).toBe(401);
    await settle(t);
    expect(await thread(t, "t-new")).toBeUndefined();
  });

  test("a push for a mailbox Comma does not hold is acknowledged and does nothing", async () => {
    const { t, as } = await setup();
    await connect(t, as);
    google.deliver(inbound("m7", "t-new", `Sam Lee <${SAM}>`));
    expect((await push(t, await google.oidcToken(), pushBody("someone@else.test"))).status).toBe(204);
    expect((await push(t, await google.oidcToken(), "{}")).status).toBe(204);
    await settle(t);
    expect(await thread(t, "t-new")).toBeUndefined();
  });

  test("connecting watches the topic; the daily cron renews; Disconnect stops it", async () => {
    const { t, as } = await setup();
    const account = await connect(t, as);
    expect(google.watches).toEqual([{ topicName: PUSH_TOPIC }]);
    await t.action(internal.comma.gmailSync.renewWatches, {});
    expect(google.watches).toHaveLength(2);
    await as.action(api.comma.googleAuth.disconnectGmail, { accountId: account._id });
    expect(google.stopped).toBe(true);
    await t.action(internal.comma.gmailSync.renewWatches, {});
    expect(google.watches).toHaveLength(2);
  });
});

describe("archive in both directions, from Gmail", () => {
  test("archiving in Gmail settles the thread and counts as cleared; moving it back unsettles it", async () => {
    seedMailbox();
    const { t, as } = await setup();
    await connect(t, as);
    const sam = (await thread(t, "t-sam"))!;
    google.relabel("t-sam", { remove: ["INBOX"] });
    await push(t, await google.oidcToken());
    await settle(t);
    expect((await stateOf(t, sam._id))?.dismissedUnrespondedGuid).toBe("m1");
    expect((await clears(t)).map((event) => event.messageGuid)).toEqual(["m1"]);
    expect((await thread(t, "t-sam"))!.gmail!.inInbox).toBe(false);

    google.relabel("t-sam", { add: ["INBOX"] });
    await push(t, await google.oidcToken());
    await settle(t);
    expect((await stateOf(t, sam._id))?.dismissedUnrespondedGuid).toBeUndefined();
    expect(await clears(t)).toEqual([]);
  });

  test("a new message reopens an archived thread on its own", async () => {
    seedMailbox();
    const { t, as } = await setup();
    await connect(t, as);
    const old = (await thread(t, "t-old-sam"))!;
    google.deliver(inbound("m8", "t-old-sam", `Sam Lee <${SAM}>`));
    await push(t, await google.oidcToken());
    await settle(t);
    const view = await as.query(api.comma.queries.getConversation, { conversationId: old._id });
    expect(view?.flags.unresponded).toBe(true);
  });
});

describe("history sync", () => {
  test("mail sent from an alias is the user's, and replying lifts a thread out of bulk", async () => {
    seedMailbox();
    const { t, as } = await setup();
    await connect(t, as);
    google.deliver({ id: "m9", threadId: "t-news", labelIds: ["SENT"], headers: { From: `Milad <${ALIAS}>`, To: "news@list.test", Subject: "Re: AUF Weekly" }, text: "Unsubscribe me" });
    await push(t, await google.oidcToken());
    await settle(t);
    expect((await thread(t, "t-news"))).toMatchObject({ gmail: { bulk: false }, lastMessage: { guid: "m9", isFromMe: true } });
  });

  test("a cursor Gmail has forgotten resyncs the inbox quietly and moves the cursor on", async () => {
    seedMailbox();
    const { t, as } = await setup();
    await connect(t, as);
    google.deliver(inbound("m10", "t-late", "Pat <pat@nowhere.test>"));
    google.relabel("t-stranger", { remove: ["INBOX"] });
    google.forgetBefore = google.historyId + 1;
    await push(t, await google.oidcToken());
    await settle(t);
    expect((await thread(t, "t-late"))?.lastMessage?.guid).toBe("m10");
    const cursor = await t.run((ctx) => ctx.db.query("comma_sync_state").withIndex("by_key", (q) => q.eq("key", "gmail:history")).unique());
    expect(Number(cursor!.cursor)).toBe(google.historyId);
  });

  test("the 5-minute backstop reads what a push missed; the backstop and the watch renewal are registered crons", async () => {
    const { t, as } = await setup();
    await connect(t, as);
    google.deliver(inbound("m11", "t-missed", `Sam Lee <${SAM}>`));
    await t.action(internal.comma.gmailSync.backstop, {});
    expect((await thread(t, "t-missed"))?.lastMessage?.guid).toBe("m11");
    const registered = (crons as unknown as { crons: Record<string, { schedule: unknown }> }).crons;
    expect(registered["comma-gmail-backstop"]?.schedule).toEqual({ type: "interval", minutes: 5 });
    expect(registered["comma-gmail-watch"]?.schedule).toMatchObject({ type: "daily" });
  });

  test("an expired access token refreshes on the next sync", async () => {
    const { t, as } = await setup();
    await connect(t, as);
    const first = google.accessToken;
    vi.advanceTimersByTime(2 * 60 * 60_000);
    google.deliver(inbound("m12", "t-later", `Sam Lee <${SAM}>`));
    await t.action(internal.comma.gmailSync.backstop, {});
    expect(google.accessToken).not.toBe(first);
    expect((await thread(t, "t-later"))?.lastMessage?.guid).toBe("m12");
  });
});

describe("the Mail list", () => {
  test("lists inbox threads newest first, with what People and All inbox filter on, and needs Milad", async () => {
    seedMailbox();
    const { t, as } = await setup();
    await connect(t, as);
    await expect(t.query(api.comma.queries.listEmailThreads, { paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow("Unauthorized");
    const { page } = await as.query(api.comma.queries.listEmailThreads, { paginationOpts: { numItems: 10, cursor: null } });
    expect(page.map((row) => [row.gmail?.threadId, row.known, row.gmail?.bulk, row.flags.unresponded])).toEqual([
      ["t-news", false, true, true], ["t-stranger", false, false, true], ["t-sam", true, false, true],
    ]);
    expect(page.find((row) => row.gmail?.threadId === "t-sam")).toMatchObject({ displayName: "Sam Lee", gmail: { subject: "Doors" } });
  });
});

describe("attachments", () => {
  const invoice = () => google.deliver(inbound("m-inv", "t-invoice", `Sam Lee <${SAM}>`, {
    subject: "Invoice #42", text: "Invoice attached.",
    html: '<p>Invoice attached.</p><img src="cid:logo@venue" alt="Venue">',
    files: [
      { filename: "invoice-42.pdf", mimeType: "application/pdf", data: "%PDF-1.7 invoice" },
      { filename: "logo.png", mimeType: "image/png", data: "PNGLOGO", contentId: "logo@venue" },
      { filename: "note.txt", mimeType: "text/plain", data: "small", inlineData: true },
    ],
  }));
  const rows = (t: T) => t.run((ctx) => ctx.db.query("comma_attachments").collect());
  const bytes = (t: T, id: Id<"_storage">) => t.run(async (ctx) => await (await ctx.storage.get(id))?.text());

  test("each part becomes an attachment stored from attachments.get, an inline image keeps its cid, and the reader lists them", async () => {
    invoice();
    const { t, as } = await setup();
    await connect(t, as);
    const stored = (await rows(t)).sort((a, b) => a.guid.localeCompare(b.guid));
    expect(stored.map((row) => [row.guid, row.platform, row.filename, row.mimeType, row.totalBytes, row.gmail])).toEqual([
      ["m-inv:1", "gmail", "invoice-42.pdf", "application/pdf", 16, { partId: "1", inline: false }],
      ["m-inv:2", "gmail", "logo.png", "image/png", 7, { partId: "2", inline: true, contentId: "logo@venue" }],
      ["m-inv:3", "gmail", "note.txt", "text/plain", 5, { partId: "3", inline: false }],
    ]);
    expect(await Promise.all(stored.map((row) => bytes(t, row.originalStorageId!)))).toEqual(["%PDF-1.7 invoice", "PNGLOGO", "small"]);
    // Gmail's attachment ids go stale between reads; each download re-read the message and used a fresh one.
    expect(google.gmailCalls("/attachments/").length).toBe(2);

    const [message] = await t.run((ctx) => ctx.db.query("comma_messages").filter((q) => q.eq(q.field("guid"), "m-inv")).collect());
    expect(message!.attachmentGuids).toEqual(["m-inv:1", "m-inv:2", "m-inv:3"]);
    expect(message!.gmail!.html).toContain('data-comma-cid="logo@venue"');
    expect(message!.gmail!.html).not.toContain("cid:");
    const conversationId = (await thread(t, "t-invoice"))!._id;
    const { page } = await as.query(api.comma.queries.listMessages, { conversationId, paginationOpts: { numItems: 10, cursor: null } });
    expect(page[0]!.attachments.map((a) => [a.filename, a.originalUrl !== null])).toEqual([["invoice-42.pdf", true], ["logo.png", true], ["note.txt", true]]);
    expect(await as.query(api.comma.media.attachmentMedia, { guid: "m-inv:1" })).toMatchObject({ guid: "m-inv:1" });

    // Reading the thread again writes nothing twice.
    await t.action(internal.comma.gmailSync.backstop, {});
    google.relabel("t-invoice", { remove: ["UNREAD"] });
    await t.action(internal.comma.gmailSync.backstop, {});
    await settle(t);
    expect((await rows(t)).length).toBe(3);
  });

  test("the files backfill gives messages stored before attachments their files, and stops at the end", async () => {
    invoice();
    const { t, as } = await setup();
    await connect(t, as);
    // As a message ingested before this change: no rows, no guids, no blobs.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("comma_attachments").collect()) {
        // A download still in flight on a slow runner has no blob yet.
        if (row.originalStorageId) await ctx.storage.delete(row.originalStorageId);
        await ctx.db.delete(row._id);
      }
      const message = (await ctx.db.query("comma_messages").collect()).find((row) => row.guid === "m-inv")!;
      await ctx.db.patch(message._id, { attachmentGuids: [] });
    });
    await t.action(internal.comma.gmailSync.startFilesBackfill, {});
    await settle(t);
    const stored = await rows(t);
    expect(stored.map((row) => row.guid).sort()).toEqual(["m-inv:1", "m-inv:2", "m-inv:3"]);
    expect(stored.every((row) => row.originalStorageId !== undefined)).toBe(true);
    const [message] = await t.run((ctx) => ctx.db.query("comma_messages").filter((q) => q.eq(q.field("guid"), "m-inv")).collect());
    expect(message!.attachmentGuids).toHaveLength(3);
  });
});

describe("the agent on an email thread", () => {
  test("reads each message's new content, quoted history and markup gone, with the thread's people", async () => {
    seedMailbox();
    const { t, as } = await setup();
    await connect(t, as);
    const conversationId = (await thread(t, "t-sam"))!._id;
    const context = await t.mutation(internal.comma.agentContext.agentContext, { conversationId, limit: 40 });
    expect(context.title).toBe("Sam Lee");
    expect(context.participants).toEqual([expect.objectContaining({ name: "Sam Lee", handles: expect.arrayContaining([SAM]) })]);
    expect(context.messages.map((message) => [message.sender, message.modelText, message.subject, message.threadRef])).toEqual([
      ["Sam Lee", "Yes, 8 works.", "Doors", "t-sam"],
    ]);
    expect(context.messages[0]!.text).toContain("Doors at 8?");
  });
});
