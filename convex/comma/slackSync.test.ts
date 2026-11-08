import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import crons from "../crons";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { sealCredentials } from "./credentials";
import { eventCallback, FakeSlack, MILAD, signedEvent, stubSlackEnv, TEAM, TOKEN } from "./fakeSlack.vitest";
import { slackRef } from "./slackEvents";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const paginationOpts = { numItems: 50, cursor: null };
const SAM = "U0SAM";
const DANA = "U0DANA";
/** A Slack ts this many minutes ago. */
const ago = (minutes: number) => (Math.floor(Date.now() / 1000) - minutes * 60).toFixed(6);

let slack: FakeSlack;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.now() });
  stubSlackEnv();
  slack = new FakeSlack().install();
  slack.users.set(SAM, { id: SAM, name: "Sam Lee", email: "sam@example.com" });
  slack.users.set(DANA, { id: DANA, name: "Dana" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function connected(slackChannels?: string[]) {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const credentials = await sealCredentials({ token: TOKEN }, `slack:${TEAM.id}`);
  const accountId = await t.run((ctx) => ctx.db.insert("comma_accounts", {
    platform: "slack", externalId: TEAM.id, label: TEAM.name, selfHandles: [`slack:${MILAD}`], health: "ok", createdAt: 1, credentials,
    ...(slackChannels ? { slackChannels } : {}),
  }));
  return { t, accountId, as: t.withIdentity({ subject: `${userId}|session` }) };
}
type T = Awaited<ReturnType<typeof connected>>["t"];

const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
const post = async (t: T, payload: object, options?: Parameters<typeof signedEvent>[1]) =>
  await t.fetch("/comma/slack/events", await signedEvent(payload, options));
const messageEvent = <M extends object>(channel: string, channelType: string, message: M) => ({ type: "message", channel, channel_type: channelType, ...message });
const conversations = (t: T) => t.run((ctx) => ctx.db.query("comma_conversations").collect());
/** In message time: events' fetches finish in any order. */
const messages = async (t: T) => (await t.run((ctx) => ctx.db.query("comma_messages").collect())).sort((a, b) => a.dateCreated - b.dateCreated);
const fetched = () => slack.calls.map((call) => call.method);

describe("the Events webhook", () => {
  test("answers Slack's url_verification challenge", async () => {
    const { t } = await connected();
    const response = await post(t, { type: "url_verification", challenge: "abc123", token: "x" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("abc123");
  });

  test("refuses an unsigned, mis-signed or stale delivery and writes nothing", async () => {
    const { t } = await connected();
    const payload = eventCallback("Ev1", messageEvent("D1", "im", { user: SAM, text: "hi", ts: ago(1) }));
    expect((await t.fetch("/comma/slack/events", { method: "POST", body: JSON.stringify(payload) })).status).toBe(401);
    expect((await post(t, payload, { secret: "wrong" })).status).toBe(401);
    expect((await post(t, payload, { at: Math.floor(Date.now() / 1000) - 6 * 60 })).status).toBe(401);
    await settle(t);
    expect(await t.run((ctx) => ctx.db.query("comma_slack_events").collect())).toEqual([]);
    expect(fetched()).toEqual([]);
  });

  test("a DM lands as a dm conversation named by its person, needing Milad, and a retry of the same event adds nothing", async () => {
    const { t, as } = await connected();
    slack.channel({ id: "D1", type: "im", user: SAM });
    const event = eventCallback("Ev1", messageEvent("D1", "im", { user: SAM, text: "lunch? <https://x.test|menu>", ts: ago(1) }));
    expect((await post(t, event)).status).toBe(200);
    expect((await post(t, event)).status).toBe(200);
    await settle(t);
    const [conversation] = await conversations(t);
    expect(conversation).toMatchObject({ platform: "slack", conversationKey: "im:D1", kind: "dm", slack: { channel: "D1" }, participants: [{ address: `slack:${SAM}` }] });
    expect(await messages(t)).toEqual([expect.objectContaining({ guid: `D1:${event.event.ts}`, text: "lunch? menu", modelText: "lunch? menu (https://x.test)", isFromMe: false })]);
    const { page: [row] } = await as.query(api.comma.queries.listConversations, { paginationOpts });
    expect(row).toMatchObject({ displayName: "Sam Lee", flags: { unresponded: true, waiting: false } });
    expect(fetched().filter((method) => method === "conversations.info")).toHaveLength(1);
  });

  test("Milad's own message in a DM is from me, and clears the inbound one", async () => {
    const { t, as } = await connected();
    slack.channel({ id: "D1", type: "im", user: SAM });
    await post(t, eventCallback("Ev1", messageEvent("D1", "im", { user: SAM, text: "lunch?", ts: ago(2) })));
    await post(t, eventCallback("Ev2", messageEvent("D1", "im", { user: MILAD, text: "yes", ts: ago(1) })));
    await settle(t);
    expect((await messages(t)).map((message) => [message.text, message.isFromMe])).toEqual([["lunch?", false], ["yes", true]]);
    const { page: [row] } = await as.query(api.comma.queries.listConversations, { paginationOpts });
    expect(row!.flags).toMatchObject({ unresponded: false, waiting: true });
  });

  test("channel chatter Milad is not in is dropped before any fetch or write", async () => {
    const { t } = await connected();
    slack.channel({ id: "C1", type: "channel", name: "general" });
    for (const [index, text] of ["morning", "anyone seen the van?", "<@U0SAM> yes"].entries()) {
      await post(t, eventCallback(`Ev${index}`, messageEvent("C1", "channel", { user: SAM, text, ts: ago(5 - index) })));
    }
    await post(t, eventCallback("EvReply", messageEvent("C1", "channel", { user: DANA, text: "same", ts: ago(1), thread_ts: ago(5) })));
    await settle(t);
    expect(await conversations(t)).toEqual([]);
    expect(await messages(t)).toEqual([]);
    expect(fetched()).toEqual([]);
  });

  test("a mention starts a thread conversation with the whole thread, and later replies in it land there", async () => {
    const { t, as } = await connected();
    const root = ago(10);
    slack.channel({ id: "C1", type: "channel", name: "bookings", messages: [
      { ts: root, user: SAM, text: "load-in time?", reply_count: 2 },
      { ts: ago(9), user: DANA, text: "6pm I think", thread_ts: root },
      { ts: ago(8), user: SAM, text: "<@U066UCP4FS6> can you confirm?", thread_ts: root },
    ] });
    await post(t, eventCallback("Ev1", messageEvent("C1", "channel", slack.channels.get("C1")!.messages[2]!)));
    await settle(t);
    const [thread] = await conversations(t);
    expect(thread).toMatchObject({ conversationKey: `th:C1:${root}`, kind: "group", rawDisplayName: "#bookings", slack: { channel: "C1", threadTs: root } });
    expect((await messages(t)).map((message) => [message.text, message.mentionsMe])).toEqual([
      ["load-in time?", false], ["6pm I think", false], ["@Milad can you confirm?", true],
    ]);
    await post(t, eventCallback("Ev2", messageEvent("C1", "channel", { user: DANA, text: "it's 6", ts: ago(1), thread_ts: root })));
    await settle(t);
    expect((await messages(t)).reverse()[0]).toMatchObject({ text: "it's 6", conversationId: thread!._id, threadRef: root });
    const { page: [row] } = await as.query(api.comma.queries.listConversations, { paginationOpts });
    expect(row).toMatchObject({ displayName: "#bookings", flags: { unresponded: true } });
  });

  test("a busy opted-in channel never needs Milad until someone mentions him", async () => {
    const { t, as } = await connected(["C2"]);
    slack.channel({ id: "C2", type: "channel", name: "ops" });
    for (let index = 0; index < 4; index++) {
      await post(t, eventCallback(`Ev${index}`, messageEvent("C2", "channel", { user: index % 2 ? SAM : DANA, text: `update ${index}`, ts: ago(10 - index) })));
    }
    await settle(t);
    const list = async () => (await as.query(api.comma.queries.listConversations, { paginationOpts })).page;
    expect(await list()).toEqual([expect.objectContaining({ kind: "channel", displayName: "#ops", flags: expect.objectContaining({ unresponded: false, waiting: false }) })]);
    await post(t, eventCallback("EvMention", messageEvent("C2", "channel", { user: SAM, text: "<@U066UCP4FS6> sign off?", ts: ago(1) })));
    await settle(t);
    expect((await list())[0]!.flags).toMatchObject({ unresponded: true });
    await post(t, eventCallback("EvMine", messageEvent("C2", "channel", { user: MILAD, text: "done", ts: ago(0) })));
    await settle(t);
    expect((await list())[0]!.flags).toMatchObject({ unresponded: false, waiting: false });
  });

  test("an edit replaces the text and a delete retracts the message", async () => {
    const { t } = await connected();
    slack.channel({ id: "D1", type: "im", user: SAM });
    const ts = ago(3);
    await post(t, eventCallback("Ev1", messageEvent("D1", "im", { user: SAM, text: "see you at 5", ts })));
    await post(t, eventCallback("Ev2", { type: "message", subtype: "message_changed", channel: "D1", channel_type: "im",
      message: { user: SAM, text: "see you at 6", ts, edited: { ts: ago(2) } } }));
    await settle(t);
    expect((await messages(t))[0]).toMatchObject({ text: "see you at 6", edited: true });
    await post(t, eventCallback("Ev3", { type: "message", subtype: "message_deleted", channel: "D1", channel_type: "im", deleted_ts: ts }));
    await settle(t);
    expect((await messages(t))[0]).toMatchObject({ retracted: true, text: "" });
  });

  test("bot messages and joins are not kept", async () => {
    const { t } = await connected();
    slack.channel({ id: "D1", type: "im", user: SAM });
    await post(t, eventCallback("Ev1", messageEvent("D1", "im", { subtype: "bot_message", bot_id: "B1", text: "reminder", ts: ago(2) })));
    await post(t, eventCallback("Ev2", messageEvent("D1", "im", { subtype: "channel_join", user: SAM, text: "joined", ts: ago(1) })));
    await settle(t);
    expect(await messages(t)).toEqual([]);
  });
});

describe("people from Slack users", () => {
  test("a user whose email is a person's joins that person; anyone else gets a person named from Slack", async () => {
    const { t } = await connected();
    const samPerson = await t.run(async (ctx) => {
      const person_id = await ctx.db.insert("people", { display_name: "Samantha Lee", normalized_phones: ["+15550001111"], normalized_emails: ["sam@example.com"],
        identity_count: 1, message_count: 0, is_self: false, auto_clustered: false, created_at: "x", updated_at: "x" });
      await ctx.db.insert("identities", { person_id, kind: "email", value: "sam@example.com", normalized: "sam@example.com", source: "apple_contact",
        is_self: false, message_count: 0, chat_count: 0, created_at: "x", updated_at: "x", display_name: "Samantha Lee" });
      await ctx.db.insert("identities", { person_id, kind: "phone", value: "+15550001111", normalized: "+15550001111", source: "apple_contact",
        is_self: false, message_count: 0, chat_count: 0, created_at: "x", updated_at: "x" });
      return person_id;
    });
    slack.channel({ id: "G1", type: "mpim", members: [MILAD, SAM, DANA] });
    await post(t, eventCallback("Ev1", messageEvent("G1", "mpim", { user: DANA, text: "hey both", ts: ago(1) })));
    await settle(t);
    const identities = await t.run((ctx) => ctx.db.query("identities").withIndex("by_kind_normalized", (q) => q.eq("kind", "slack")).collect());
    const byUser = Object.fromEntries(identities.map((identity) => [identity.value, identity]));
    expect(byUser[`slack:${SAM}`]?.person_id).toBe(samPerson);
    const dana = await t.run((ctx) => ctx.db.get(byUser[`slack:${DANA}`]!.person_id!));
    expect(dana).toMatchObject({ display_name: "Dana", auto_clustered: true, normalized_phones: [] });
    expect(await t.run((ctx) => ctx.db.get(samPerson))).toMatchObject({ display_name: "Samantha Lee", normalized_phones: ["+15550001111"] });
    const [group] = await conversations(t);
    expect(group).toMatchObject({ kind: "group", rawDisplayName: "", participants: [{ address: `slack:${SAM}` }, { address: `slack:${DANA}` }] });
  });

  test("a profile change renames the user's identity", async () => {
    const { t } = await connected();
    slack.channel({ id: "D1", type: "im", user: DANA });
    await post(t, eventCallback("Ev1", messageEvent("D1", "im", { user: DANA, text: "hi", ts: ago(1) })));
    await post(t, eventCallback("Ev2", { type: "user_change", user: { id: DANA, name: "dana", profile: { display_name: "Dana K" } } }));
    await settle(t);
    const identity = await t.run((ctx) => ctx.db.query("identities").withIndex("by_kind_normalized", (q) => q.eq("kind", "slack").eq("normalized", `slack:${DANA}`)).first());
    expect(await t.run((ctx) => ctx.db.get(identity!.person_id!))).toMatchObject({ display_name: "Dana K" });
  });
});

describe("backfill", () => {
  function workspace() {
    slack.pageSize = 2;
    const threadRoot = ago(600);
    slack.channel({ id: "D1", type: "im", user: SAM, messages: [
      { ts: ago(60 * 24 * 120), user: SAM, text: "too old" },
      ...[5, 4, 3, 2, 1].map((hours) => ({ ts: ago(hours * 60), user: hours % 2 ? SAM : MILAD, text: `dm ${hours}` })),
    ] });
    slack.channel({ id: "G1", type: "mpim", members: [MILAD, SAM, DANA], messages: [{ ts: ago(90), user: DANA, text: "group hello" }] });
    slack.channel({ id: "C9", type: "channel", name: "random", messages: [
      { ts: threadRoot, user: DANA, text: "who has the keys?", reply_count: 2 },
      { ts: ago(590), user: MILAD, text: "I do", thread_ts: threadRoot },
      { ts: ago(580), user: DANA, text: "thanks", thread_ts: threadRoot },
      { ts: ago(30), user: SAM, text: "unrelated chatter" },
    ] });
  }

  async function connectThroughOAuth(t: T, as: Awaited<ReturnType<typeof connected>>["as"]) {
    const install = new URL(await as.action(api.comma.slackAuth.startSlackConnect, {}));
    await t.fetch(`/comma/oauth/slack/callback?code=good-code&state=${install.searchParams.get("state")}`, { method: "GET" });
    await settle(t);
  }

  test("reads 90 days of DMs and group DMs, and the threads Milad is in, across pages", async () => {
    workspace();
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
    const as = t.withIdentity({ subject: `${userId}|session` });
    await connectThroughOAuth(t, as);
    const keys = (await conversations(t)).map((conversation) => conversation.conversationKey).sort();
    expect(keys).toEqual(["im:D1", "mpim:G1", `th:C9:${slack.channels.get("C9")!.messages[0]!.ts}`]);
    const texts = (await messages(t)).map((message) => message.text).sort();
    expect(texts).toEqual(["I do", "dm 1", "dm 2", "dm 3", "dm 4", "dm 5", "group hello", "thanks", "who has the keys?"]);
    const [state] = await t.run((ctx) => ctx.db.query("comma_sync_state").collect());
    expect(JSON.parse(state!.cursor!)).toMatchObject({ step: "done" });
  });

  test("a second run writes nothing new, and a rate limit waits and carries on", async () => {
    workspace();
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
    const as = t.withIdentity({ subject: `${userId}|session` });
    slack.rateLimitOnce.set("conversations.history", 2);
    await connectThroughOAuth(t, as);
    const first = { conversations: (await conversations(t)).length, messages: await messages(t) };
    expect(first.messages).toHaveLength(9);
    const [{ _id: accountId }] = await as.query(api.comma.accounts.listAccounts, {});
    await t.mutation(internal.comma.slackSync.startBackfill, { accountId });
    await settle(t);
    expect((await conversations(t)).length).toBe(first.conversations);
    expect(await messages(t)).toEqual(first.messages);
  });

  test("an opted-in channel's top-level messages are read too", async () => {
    workspace();
    const { t, accountId } = await connected(["C9"]);
    await t.mutation(internal.comma.slackSync.startBackfill, { accountId });
    await settle(t);
    const channel = (await conversations(t)).find((conversation) => conversation.conversationKey === "ch:C9");
    expect(channel).toMatchObject({ kind: "channel", rawDisplayName: "#random" });
    expect((await messages(t)).filter((message) => message.conversationId === channel!._id).map((message) => message.text).sort())
      .toEqual(["unrelated chatter", "who has the keys?"]);
  });
});

describe("the backstop cron", () => {
  test("is registered every 15 minutes", () => {
    expect((crons as unknown as { crons: Record<string, { schedule: unknown }> }).crons["comma-slack-backstop"]?.schedule)
      .toEqual({ type: "interval", minutes: 15 });
  });

  test("lands a message the webhook never delivered in an active conversation, and prunes old event ids", async () => {
    const { t, accountId } = await connected();
    const dm = slack.channel({ id: "D1", type: "im", user: SAM });
    dm.messages.push({ ts: ago(20), user: SAM, text: "first" });
    await post(t, eventCallback("EvOld", messageEvent("D1", "im", dm.messages[0]!)));
    await settle(t);
    dm.messages.push({ ts: ago(5), user: SAM, text: "sent while the webhook was down" });
    await t.run((ctx) => ctx.db.insert("comma_slack_events", { eventId: "EvAncient", receivedAt: Date.now() - 2 * 60 * 60_000 }));
    await t.action(internal.comma.slackSync.backstop, {});
    expect((await messages(t)).map((message) => message.text)).toEqual(["first", "sent while the webhook was down"]);
    expect((await t.run((ctx) => ctx.db.query("comma_slack_events").collect())).map((row) => row.eventId)).toEqual(["EvOld"]);
    const state = await t.run((ctx) => ctx.db.query("comma_sync_state").withIndex("by_account_key", (q) => q.eq("accountId", accountId as Id<"comma_accounts">).eq("key", "slack:backstop")).unique());
    expect(state?.lastReconcileAt).toBeGreaterThan(0);
  });
});

describe("slackRef", () => {
  const self = MILAD;
  const at = (ts: string, extra: object = {}) => ({ ts, user: SAM, text: "hi", ...extra });
  test("keeps every DM and group DM message, and a channel's only where Milad is in it or opted in", () => {
    const rules = { self, optedIn: false, threadKnown: false };
    expect(slackRef("D1", "im", at("1.0"), rules)).toEqual({ type: "im", channel: "D1" });
    expect(slackRef("G1", "mpim", at("1.0"), rules)).toEqual({ type: "mpim", channel: "G1" });
    expect(slackRef("C1", "channel", at("1.0"), rules)).toBeNull();
    expect(slackRef("C1", "group", at("1.0", { user: self }), rules)).toEqual({ type: "thread", channel: "C1", threadTs: "1.0" });
    expect(slackRef("C1", "channel", at("2.0", { thread_ts: "1.0", threadTs: "1.0" }), rules)).toBeNull();
    expect(slackRef("C1", "channel", at("2.0", { threadTs: "1.0", text: `<@${self}|milad> ok?` }), rules)).toEqual({ type: "thread", channel: "C1", threadTs: "1.0" });
    expect(slackRef("C1", "channel", at("2.0", { threadTs: "1.0" }), { ...rules, threadKnown: true })).toEqual({ type: "thread", channel: "C1", threadTs: "1.0" });
    expect(slackRef("C1", "channel", at("1.0"), { ...rules, optedIn: true })).toEqual({ type: "channel", channel: "C1" });
  });
});

describe("Slack's connection status", () => {
  test("the webhook marks it connected, writing at most once a minute however busy the workspace", async () => {
    const { t, accountId, as } = await connected();
    for (let index = 0; index < 5; index++) {
      await post(t, eventCallback(`Ev${index}`, messageEvent("C1", "channel", { user: SAM, text: "chatter", ts: ago(5 - index) })));
    }
    const status = await as.query(api.comma.bridgeState.routeExecutorStatus, { platform: "slack", accountId });
    expect(status).toMatchObject({ connected: true, capabilities: { executor: "slack" } });
    const rows = await t.run((ctx) => ctx.db.query("comma_bridge_state").collect());
    expect(rows).toHaveLength(1);
    const firstSeen = status!.lastSeenAt;
    vi.setSystemTime(Date.now() + 61_000);
    await post(t, eventCallback("EvLater", messageEvent("C1", "channel", { user: SAM, text: "chatter", ts: ago(0) })));
    expect((await as.query(api.comma.bridgeState.routeExecutorStatus, { platform: "slack", accountId }))!.lastSeenAt).toBeGreaterThan(firstSeen);
  });
});
