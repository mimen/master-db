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
import { eventCallback, FakeSlack, MILAD, signedEvent, stubSlackEnv, TEAM, TOKEN } from "./fakeSlack.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const SAM = "U0SAM";
const SAM_TS = "1700000000.000100";

let slack: FakeSlack;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.now() });
  stubSlackEnv();
  slack = new FakeSlack().install();
  slack.users.set(SAM, { id: SAM, name: "Sam Lee" });
  slack.channel({ id: "D1", type: "im", user: SAM, messages: [{ ts: SAM_TS, user: SAM, text: "lunch?" }] });
  slack.channel({ id: "C1", type: "channel", name: "bookings", messages: [{ ts: "1700000000.000200", user: SAM, text: "thread root", reply_count: 1 }] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function connected() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const credentials = await sealCredentials({ token: TOKEN }, `slack:${TEAM.id}`);
  const { dm, thread, accountId } = await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("comma_accounts", {
      platform: "slack", externalId: TEAM.id, label: TEAM.name, selfHandles: [`slack:${MILAD}`], health: "ok", createdAt: 1, credentials,
    });
    const base = { platform: "slack" as const, accountId, isSpam: false, lastMessageAt: 1, updatedAt: 1 };
    const dm = await ctx.db.insert("comma_conversations", {
      ...base, conversationKey: "im:D1", slack: { channel: "D1" }, kind: "dm", displayName: "Sam Lee", isGroup: false,
      participants: [{ address: `slack:${SAM}`, name: null }],
    });
    const thread = await ctx.db.insert("comma_conversations", {
      ...base, conversationKey: "th:C1:1700000000.000200", slack: { channel: "C1", threadTs: "1700000000.000200", following: true }, kind: "group",
      displayName: "#bookings", rawDisplayName: "#bookings", isGroup: true, participants: [{ address: `slack:${SAM}`, name: null }],
    });
    await ctx.db.insert("comma_messages", {
      platform: "slack", accountId, conversationId: dm, guid: `D1:${SAM_TS}`, dateCreated: 1_700_000_000_000, isFromMe: false,
      sender: { address: `slack:${SAM}`, name: null }, text: "lunch?", mentions: [], edited: false, retracted: false, isGroupEvent: false,
      attachmentGuids: [], sourceVersion: 0,
    });
    return { dm, thread, accountId };
  });
  const as = t.withIdentity({ subject: `${userId}|session` });
  const run = async (clientKey: string, payload: CommaOutboxPayload, conversationId: Id<"comma_conversations"> = dm) => {
    await as.mutation(api.comma.outbox.enqueue, { clientKey, conversationId, payload });
    await settle(t);
    return await t.run(async (ctx) => (await ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey)).unique())!);
  };
  const messages = (conversationId = dm) => t.run(async (ctx) => (await ctx.db.query("comma_messages")
    .withIndex("by_conversation_date", (q) => q.eq("conversationId", conversationId)).collect()));
  const thread_ = (conversationId = dm) => as.query(api.comma.queries.listMessages, { conversationId, paginationOpts: { numItems: 50, cursor: null } });
  return { t, as, dm, thread, accountId, run, messages, thread_ };
}

/** One timer at a time, each function finished before the next fires, so a 3-minute expiry never overtakes a running drive. */
const settle = (t: { finishAllScheduledFunctions: (advance: () => void) => Promise<void> }) =>
  t.finishAllScheduledFunctions(() => vi.advanceTimersToNextTimer());
const posts = () => slack.calls.filter((call) => call.method === "chat.postMessage");
const slackDm = () => slack.channels.get("D1")!.messages;

describe("sending to Slack", () => {
  test("a send shows its bubble at once, then becomes Slack's message in one write, and Slack's own echo adds nothing", async () => {
    const { t, as, dm, run, messages } = await connected();
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "s1", conversationId: dm, payload: { kind: "send", text: "on my way <3 & co" } });
    expect((await messages()).map((row) => [row.guid, row.sendState])).toEqual([[`D1:${SAM_TS}`, undefined], [pendingGuid("s1"), "queued"]]);
    await settle(t);

    const [sent] = slackDm().slice(-1);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.params).toMatchObject({ channel: "D1", text: "on my way &lt;3 &amp; co" });
    expect(JSON.parse(posts()[0]!.params.metadata!)).toEqual({ event_type: "comma_send", event_payload: { clientKey: "s1" } });
    expect(await run("s1", { kind: "send", text: "on my way <3 & co" })).toMatchObject({ status: "sent", resultGuid: `D1:${sent!.ts}` });
    const landed = await messages();
    expect(landed.map((row) => [row.guid, row.text, row.isFromMe, row.clientKey])).toEqual([
      [`D1:${SAM_TS}`, "lunch?", false, undefined], [`D1:${sent!.ts}`, "on my way <3 & co", true, "s1"],
    ]);
    expect(await t.run((ctx) => ctx.db.get(dm))).toMatchObject({ lastMessage: { guid: `D1:${sent!.ts}`, isFromMe: true } });

    await t.fetch("/comma/slack/events", await signedEvent(eventCallback("Ev1", { type: "message", channel: "D1", channel_type: "im", ...sent })));
    await settle(t);
    expect((await messages()).map((row) => row.guid)).toEqual([`D1:${SAM_TS}`, `D1:${sent!.ts}`]);
    expect(posts()).toHaveLength(1);
  });

  test("a reply goes into the replied message's thread, and a thread conversation's send into its own thread", async () => {
    const { run, thread, messages } = await connected();
    await run("r1", { kind: "send", text: "yes", replyToGuid: `D1:${SAM_TS}` });
    expect(posts()[0]!.params).toMatchObject({ channel: "D1", thread_ts: SAM_TS });
    expect(await run("r2", { kind: "send", text: "booked" }, thread)).toMatchObject({ status: "sent" });
    expect(posts()[1]!.params).toMatchObject({ channel: "C1", thread_ts: "1700000000.000200" });
    expect((await messages(thread)).map((row) => [row.text, row.isFromMe])).toEqual([["booked", true]]);
  });

  test("an echo that beats the receipt retires the bubble by its clientKey, and the receipt then adds nothing", async () => {
    const { t, as, dm, accountId, messages } = await connected();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await slack.fetch(input, init);
      if (String(input).endsWith("/chat.postMessage")) {
        const [echo] = slackDm().slice(-1);
        await t.action(internal.comma.slackSync.ingestEvent, {
          accountId, ref: { type: "im", channel: "D1" }, isNew: false, message: { ts: echo!.ts, user: MILAD, text: echo!.text, clientKey: "e1" },
        });
        expect((await messages()).map((row) => row.guid)).toEqual([`D1:${SAM_TS}`, `D1:${echo!.ts}`]);
      }
      return response;
    });
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "e1", conversationId: dm, payload: { kind: "send", text: "hi" } });
    await settle(t);
    expect((await messages()).map((row) => [row.text, row.sendState])).toEqual([["lunch?", undefined], ["hi", undefined]]);
    expect(await t.run(async (ctx) => (await ctx.db.query("comma_outbox").collect()).map((row) => row.status))).toEqual(["sent"]);
  });
});

describe("a scheduled Slack message", () => {
  test("posts at its time through the Slack lane with no client open, and a cancelled one never posts", async () => {
    const { t, as, dm, messages } = await connected();
    const sendAt = Date.now() + 3_600_000;
    const id = await as.mutation(api.comma.scheduledSends.schedule, { conversationId: dm, sendAt, payload: { kind: "send", text: "lunch at 1" } });
    const cancelled = await as.mutation(api.comma.scheduledSends.schedule, { conversationId: dm, sendAt, payload: { kind: "send", text: "never" } });
    await as.mutation(api.comma.scheduledSends.cancel, { scheduledId: cancelled });
    vi.advanceTimersByTime(3_540_000);
    await t.finishInProgressScheduledFunctions();
    expect(posts()).toEqual([]);

    await settle(t);
    expect(Date.now()).toBeGreaterThanOrEqual(sendAt);
    expect(posts().map((call) => call.params.text)).toEqual(["lunch at 1"]);
    expect((await messages()).map((row) => [row.text, row.clientKey, row.sendState])).toEqual([["lunch?", undefined, undefined], ["lunch at 1", `scheduled-${id}`, undefined]]);
    expect(await as.query(api.comma.queries.listScheduled, {})).toEqual([]);
  });
});

describe("Slack's refusals and unknown outcomes", () => {
  test.each([
    ["an error answer", { ok: false, error: "not_in_channel" }, "Slack chat.postMessage failed: not_in_channel"],
    ["a revoked token", { ok: false, error: "invalid_auth" }, "Slack chat.postMessage failed: invalid_auth"],
  ])("%s fails the send, which the user may retry, and nothing is looked for", async (_name, answer, error) => {
    const { run, messages } = await connected();
    slack.on("chat.postMessage", () => answer);
    expect(await run("f1", { kind: "send", text: "hi" })).toMatchObject({ status: "failed", error });
    expect((await messages()).map((row) => row.sendState)).toEqual([undefined, "failed"]);
    expect(slack.calls.filter((call) => call.method === "conversations.history")).toEqual([]);
  });

  test("a rate limit is Slack refusing before it posted, so the send fails", async () => {
    const { run } = await connected();
    slack.rateLimitOnce.set("chat.postMessage", 30);
    expect(await run("f2", { kind: "send", text: "hi" })).toMatchObject({ status: "failed", error: "Slack chat.postMessage failed: ratelimited" });
  });

  /** Slack posts the message, then the answer never arrives. */
  function loseAnswers(method: string, error: () => Error | Response) {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await slack.fetch(input, init);
      if (String(input).endsWith(`/${method}`)) {
        const lost = error();
        if (lost instanceof Response) return lost;
        throw lost;
      }
      return response;
    });
  }

  test("a send that timed out after Slack posted it ends unknown, is found by its clientKey, lands once and is never posted again", async () => {
    const { t, as, dm, messages } = await connected();
    loseAnswers("chat.postMessage", () => new DOMException("The operation timed out.", "TimeoutError"));
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "u1", conversationId: dm, payload: { kind: "send", text: "see you" } });
    vi.advanceTimersToNextTimer();
    await t.finishInProgressScheduledFunctions();
    const row = () => t.run(async (ctx) => (await ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", "u1")).unique())!);
    expect(await row()).toMatchObject({ status: "unknown" });
    expect((await messages()).map((message) => [message.guid, message.sendState])).toEqual([[`D1:${SAM_TS}`, undefined], [pendingGuid("u1"), "failed"]]);

    await settle(t);
    const [sent] = slackDm().slice(-1);
    expect(await row()).toMatchObject({ status: "sent", resultGuid: `D1:${sent!.ts}` });
    expect((await row()).error).toBeUndefined();
    expect((await messages()).map((message) => [message.guid, message.text, message.sendState])).toEqual([
      [`D1:${SAM_TS}`, "lunch?", undefined], [`D1:${sent!.ts}`, "see you", undefined],
    ]);
    expect(posts()).toHaveLength(1);
    expect(slack.calls.filter((call) => call.method === "conversations.history")).toHaveLength(1);
    await expect(as.mutation(api.comma.pendingSends.retrySend, { clientKey: "u1", retryKey: "u1-again" })).rejects.toThrow("Only a send that did not go out");
  });

  test("without metadata the check finds the send by Milad's id and its exact text", async () => {
    const { run, messages } = await connected();
    slack.keepsMetadata = false;
    loseAnswers("chat.postMessage", () => new Response("upstream timeout", { status: 504 }));
    expect(await run("u2", { kind: "send", text: "a & b" })).toMatchObject({ status: "sent" });
    expect((await messages()).map((message) => [message.text, message.isFromMe, message.sendState])).toEqual([["lunch?", false, undefined], ["a & b", true, undefined]]);
    expect(posts()).toHaveLength(1);
  });

  test("a send that never reached Slack stays unknown after both checks, and nothing posts it", async () => {
    const { run, messages } = await connected();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/chat.postMessage")) throw new TypeError("fetch failed");
      return await slack.fetch(input, init);
    });
    expect(await run("u3", { kind: "send", text: "lost" })).toMatchObject({ status: "unknown" });
    expect((await messages()).map((message) => message.sendState)).toEqual([undefined, "failed"]);
    expect(slack.calls.filter((call) => call.method === "conversations.history")).toHaveLength(2);
    expect(slackDm()).toHaveLength(1);
  });

  test("the text check never takes a message another send already owns", async () => {
    const { t, as, dm, run } = await connected();
    slack.keepsMetadata = false;
    expect(await run("ok1", { kind: "send", text: "ok" })).toMatchObject({ status: "sent" });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/chat.postMessage")) throw new TypeError("fetch failed");
      return await slack.fetch(input, init);
    });
    await as.mutation(api.comma.outbox.enqueue, { clientKey: "ok2", conversationId: dm, payload: { kind: "send", text: "ok" } });
    await settle(t);
    const row = await t.run(async (ctx) => (await ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", "ok2")).unique())!);
    expect(row.status).toBe("unknown");
  });
});

describe("acting on Slack messages", () => {
  test("Milad keeps many reactions on one message; each adds and removes by Slack's emoji name", async () => {
    const { run, thread_ } = await connected();
    const target = `D1:${SAM_TS}`;
    await run("x1", { kind: "react", messageGuid: target, reaction: "emoji:👍", remove: false });
    await run("x2", { kind: "react", messageGuid: target, reaction: "emoji:🔥", remove: false });
    const reactions = async () => (await thread_()).page.find((message) => message.guid === target)!.reactions.map((r) => [r.key, r.isFromMe]);
    expect(await reactions()).toEqual([["emoji:👍", true], ["emoji:🔥", true]]);
    expect(slackDm()[0]!.reactions).toEqual([{ name: "+1", users: [MILAD] }, { name: "fire", users: [MILAD] }]);

    expect(await run("x3", { kind: "react", messageGuid: target, reaction: "emoji:👍", remove: true })).toMatchObject({ status: "sent" });
    expect(await reactions()).toEqual([["emoji:🔥", true]]);
    expect(slack.calls.filter((call) => call.method.startsWith("reactions.")).map((call) => [call.method, call.params.name, call.params.timestamp]))
      .toEqual([["reactions.add", "+1", SAM_TS], ["reactions.add", "fire", SAM_TS], ["reactions.remove", "+1", SAM_TS]]);
  });

  test("a reaction Slack already holds is done, and an emoji Comma has no Slack name for fails before any call", async () => {
    const { run } = await connected();
    slackDm()[0]!.reactions = [{ name: "heart", users: [MILAD] }];
    expect(await run("y1", { kind: "react", messageGuid: `D1:${SAM_TS}`, reaction: "emoji:❤", remove: false })).toMatchObject({ status: "sent" });
    const calls = slack.calls.length;
    expect(await run("y2", { kind: "react", messageGuid: `D1:${SAM_TS}`, reaction: "emoji:🦩", remove: false }))
      .toMatchObject({ status: "failed", error: "Slack can't send that reaction" });
    expect(slack.calls.length).toBe(calls);
  });

  test("an edit and a delete of Milad's message reach Slack and show at once", async () => {
    const { run, messages, t, dm } = await connected();
    const { resultGuid } = await run("m1", { kind: "send", text: "draft" });
    await run("m2", { kind: "edit", messageGuid: resultGuid!, text: "final <b>" });
    expect(slack.calls.find((call) => call.method === "chat.update")!.params).toMatchObject({ channel: "D1", text: "final &lt;b&gt;" });
    expect((await messages()).slice(-1)[0]).toMatchObject({ guid: resultGuid, text: "final <b>", edited: true });
    expect(await t.run((ctx) => ctx.db.get(dm))).toMatchObject({ lastMessage: { text: "final <b>" } });

    expect(await run("m3", { kind: "unsend", messageGuid: resultGuid! })).toMatchObject({ status: "sent" });
    expect((await messages()).slice(-1)[0]).toMatchObject({ guid: resultGuid, retracted: true, text: "" });
    expect(slackDm().map((message) => message.ts)).toEqual([SAM_TS]);
  });

  test("Slack refuses an edit of someone else's message, and the row fails", async () => {
    const { run } = await connected();
    expect(await run("n1", { kind: "edit", messageGuid: `D1:${SAM_TS}`, text: "nope" }))
      .toMatchObject({ status: "failed", error: "Slack chat.update failed: cant_update_message" });
  });

  test("a read marks the conversation at its newest message; a thread's read stays in Comma", async () => {
    const { as, dm, thread, t } = await connected();
    await as.mutation(api.comma.triage.markRead, { conversationId: dm, at: Date.now() });
    await settle(t);
    expect(slack.marks.get("D1")).toBe(SAM_TS);
    await as.mutation(api.comma.triage.markRead, { conversationId: thread, at: Date.now() });
    await settle(t);
    expect(slack.calls.filter((call) => call.method === "conversations.mark")).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.query("comma_outbox").collect())).map((row) => row.status)).toEqual(["sent", "sent"]);
  });
});
