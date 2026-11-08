import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api } from "../_generated/api";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { sealCredentials } from "./credentials";
import { FakeSlack, MILAD, stubSlackEnv, TEAM, TOKEN } from "./fakeSlack.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const ago = (minutes: number) => (Math.floor(Date.now() / 1000) - minutes * 60).toFixed(6);
const SAM = "U0SAM";

let slack: FakeSlack;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.now() });
  stubSlackEnv();
  slack = new FakeSlack().install();
  slack.users.set(SAM, { id: SAM, name: "Sam Lee" });
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
  const accountId = await t.run((ctx) => ctx.db.insert("comma_accounts", {
    platform: "slack", externalId: TEAM.id, label: TEAM.name, selfHandles: [`slack:${MILAD}`], health: "ok", createdAt: 1, credentials,
  }));
  return { t, accountId, as: t.withIdentity({ subject: `${userId}|session` }) };
}

describe("channel opt-ins", () => {
  test("lists Milad's channels by name with the ones Comma follows, and refuses a caller who isn't Milad", async () => {
    const { t, as, accountId } = await connected();
    slack.channel({ id: "C2", type: "channel", name: "ops" });
    slack.channel({ id: "C1", type: "channel", name: "bookings" });
    await t.run((ctx) => ctx.db.patch(accountId, { slackChannels: ["C2"] }));
    expect(await as.action(api.comma.slackChannels.listSlackChannels, { accountId })).toEqual([
      { id: "C1", name: "bookings", isPrivate: false, following: false },
      { id: "C2", name: "ops", isPrivate: false, following: true },
    ]);
    await expect(t.action(api.comma.slackChannels.listSlackChannels, { accountId })).rejects.toThrow("Unauthorized");
    await expect(t.mutation(api.comma.slackChannels.setSlackChannel, { accountId, channel: "C1", name: "bookings", following: true }))
      .rejects.toThrow("Unauthorized");
  });

  test("following a channel reads its 90 days and threads, moving Milad's thread root into it; stopping keeps them", async () => {
    const { t, as, accountId } = await connected();
    const mine = ago(30);
    const theirs = ago(20);
    slack.channel({ id: "C1", type: "channel", name: "bookings", messages: [
      { ts: mine, user: SAM, text: "who's on doors?", reply_count: 1 },
      { ts: ago(29), user: MILAD, text: "me", thread_ts: mine },
      { ts: theirs, user: SAM, text: "parking?", reply_count: 1 },
      { ts: ago(19), user: SAM, text: "lot B", thread_ts: theirs },
      { ts: ago(10), user: SAM, text: "doors at 8" },
    ] });
    // Before S3's opt-in, Milad's thread was its own conversation, root included.
    await t.run(async (ctx) => {
      const threadId = await ctx.db.insert("comma_conversations", {
        platform: "slack", accountId, conversationKey: `th:C1:${mine}`, kind: "thread", isGroup: true, slack: { channel: "C1", threadTs: mine },
        displayName: "#bookings", rawDisplayName: "#bookings", participants: [], lastMessageAt: 1, isSpam: false, updatedAt: 1,
      });
      await ctx.db.insert("comma_messages", {
        platform: "slack", accountId, conversationId: threadId, guid: `C1:${mine}`, dateCreated: 1, isFromMe: false, text: "who's on doors?",
        edited: false, retracted: false, isGroupEvent: false, mentions: [], attachmentGuids: [], sourceVersion: 0,
      });
    });

    await as.mutation(api.comma.slackChannels.setSlackChannel, { accountId, channel: "C1", name: "bookings", following: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(accountId)))!.slackChannels).toEqual(["C1"]);
    const rows = await t.run((ctx) => ctx.db.query("comma_conversations").collect());
    const key = (conversationKey: string) => rows.find((row) => row.conversationKey === conversationKey)!;
    expect(key("ch:C1")).toMatchObject({ kind: "channel", rawDisplayName: "#bookings" });
    expect(key(`th:C1:${mine}`).slack).toEqual({ channel: "C1", threadTs: mine, following: true });
    expect(key(`th:C1:${theirs}`).slack).toEqual({ channel: "C1", threadTs: theirs, following: false });
    const channelMessages = await as.query(api.comma.queries.listMessages, { conversationId: key("ch:C1")._id, paginationOpts: { numItems: 20, cursor: null } });
    expect(channelMessages.page.map((message) => [message.text, message.thread?.replyCount])).toEqual([
      ["doors at 8", undefined], ["parking?", 1], ["who's on doors?", 1],
    ]);

    await as.mutation(api.comma.slackChannels.setSlackChannel, { accountId, channel: "C1", name: "bookings", following: false });
    expect((await t.run((ctx) => ctx.db.get(accountId)))!.slackChannels).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("comma_messages").collect())).toHaveLength(5);
  });
});
