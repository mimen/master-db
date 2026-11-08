import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { PERSON_SUMMARY } from "./personSummaries";
import { namePerson } from "./testModules.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const ALEX = "+15550001111";
const CHAT = `iMessage;-;${ALEX}`;
const SLACK_ALEX = "slack:U-ALEX";
const MINUTE = 60_000;

beforeEach(() => {
  process.env.COMMA_BRIDGE_SECRET = "test";
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

const inbound = (conversationId: Id<"comma_conversations">, guid: string, overrides: Record<string, unknown> = {}) => ({
  guid, conversationId, chatGuid: CHAT, dateCreated: Date.now(), isFromMe: false, text: `text of ${guid}`, service: "iMessage" as const,
  sender: { address: ALEX, name: null }, error: 0, edited: false, retracted: false, isTapback: false, reactions: [],
  isGroupEvent: false, mentions: [], attachmentGuids: [], sourceVersion: 1, ...overrides,
});

/** A Slack conversation and one message in it from `sender`, written the way slackSync stores them. */
async function slackMessage(ctx: MutationCtx, kind: "dm" | "channel", guid: string, sender: string, fromMe = false) {
  const conversationId = await ctx.db.insert("comma_conversations", {
    platform: "slack", conversationKey: `slack:${kind}:${guid}`, kind, isGroup: kind !== "dm", displayName: kind === "dm" ? "Alex Rivera" : "#production",
    slack: { channel: `C-${guid}` }, participants: [{ address: SLACK_ALEX, name: "Alex Rivera" }], isSpam: false, updatedAt: 1,
    lastMessage: { guid, text: "slack", dateCreated: Date.now(), isFromMe: fromMe, senderName: null, hasAttachments: false }, lastMessageAt: Date.now(),
  });
  await ctx.db.insert("comma_messages", {
    platform: "slack", conversationId, guid, dateCreated: Date.now(), isFromMe: fromMe, sender: { address: sender, name: null },
    text: `${kind} words`, mentions: [], mentionsMe: false, edited: false, retracted: false, isGroupEvent: false, attachmentGuids: [], sourceVersion: 1,
  });
  return conversationId;
}

async function world(options: { aiSeenAt?: number } = {}) {
  const t = convexTest(schema, modules);
  const map = await t.mutation(internal.comma.internal.upsertConversations, { conversations: [{
    conversationKey: `dm:${ALEX}`, chats: [{ chatGuid: CHAT, lastMessageAt: 1 }], displayName: "Alex",
    isGroup: false, participants: [{ address: ALEX, name: null }], isSpam: false, hasGroupPhoto: false, lastMessageAt: 1,
  }] });
  const conversationId = map[CHAT]!;
  const personId = await t.run(async (ctx) => {
    const id = await namePerson(ctx, ALEX, "Alex Rivera");
    await ctx.db.insert("identities", { person_id: id, kind: "slack", value: SLACK_ALEX, normalized: SLACK_ALEX, source: "manual",
      is_self: false, message_count: 0, chat_count: 0, created_at: "x", updated_at: "x" });
    await ctx.db.insert("comma_bridge_state", { key: "ai", connected: true, lastSeenAt: options.aiSeenAt ?? Date.now() + 24 * 60 * MINUTE,
      capabilities: { executor: "ai", suggestions: true, whisperAvailable: false } });
    return id;
  });
  const post = (...messages: ReturnType<typeof inbound>[]) => t.mutation(internal.comma.internal.upsertMessages, { messages });
  const summaryCommands = async () => {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return (await t.run((ctx) => ctx.db.query("comma_outbox").collect())).filter((row) => row.payload.kind === "personSummary")
      .map((row) => ({ clientKey: row.clientKey, lane: row.lane, payload: row.payload, conversationId: row.conversationId }));
  };
  return { t, as: t.withIdentity({ email: ALLOWED_EMAIL }), conversationId, personId, post, summaryCommands };
}

describe("the debounce", () => {
  test("a burst of a person's messages rebuilds their summary once, 30 minutes after the last, on the aiBackground lane", async () => {
    const w = await world();
    const start = Date.now();
    await w.post(inbound(w.conversationId, "m1"));
    vi.setSystemTime(start + 10 * MINUTE);
    await w.post(inbound(w.conversationId, "m2"));
    vi.setSystemTime(start + 20 * MINUTE);
    await w.post(inbound(w.conversationId, "m3"));
    expect(await w.summaryCommands()).toEqual([{
      clientKey: `personSummary:${w.personId}:${start + 20 * MINUTE + PERSON_SUMMARY.debounceMs}`, lane: "aiBackground",
      payload: { kind: "personSummary", personId: w.personId }, conversationId: w.conversationId,
    }]);
    expect(await w.t.run((ctx) => ctx.db.query("comma_person_summaries").collect())).toMatchObject([{ personId: w.personId, conversationId: w.conversationId }]);
    expect((await w.t.run((ctx) => ctx.db.query("comma_person_summaries").collect()))[0]!.dueAt).toBeUndefined();
  });

  test.each([
    ["history a backfill posts", { dateCreated: Date.now() - 11 * MINUTE }],
    ["Milad's own message", { isFromMe: true }],
  ])("%s rebuilds nothing", async (_label, overrides) => {
    const w = await world();
    await w.post(inbound(w.conversationId, "m1", overrides));
    expect(await w.summaryCommands()).toEqual([]);
  });

  test("with the AI process gone quiet, the rebuild is dropped rather than piled up", async () => {
    const w = await world({ aiSeenAt: Date.now() });
    await w.post(inbound(w.conversationId, "m1"));
    expect(await w.summaryCommands()).toEqual([]);
  });
});

describe("what the summary reads and keeps", () => {
  test("the context spans the person's platforms and leaves out channel chatter", async () => {
    const w = await world();
    await w.post(inbound(w.conversationId, "m1"));
    await w.t.run(async (ctx) => {
      await slackMessage(ctx, "dm", "s1", SLACK_ALEX);
      await slackMessage(ctx, "channel", "s2", SLACK_ALEX);
    });
    const context = await w.t.mutation(internal.comma.personSummaries.personSummaryContext, { personId: w.personId });
    expect(context?.name).toBe("Alex Rivera");
    expect(context?.lines.map((line) => [line.platform, line.text]).sort()).toEqual([["imessage", "text of m1"], ["slack", "dm words"]]);
  });

  test("a summary lands unless a newer one already did, and the agent and Today read it", async () => {
    const w = await world();
    const summary = (basedOnAt: number, text: string) => ({ text, points: ["Stage plot unanswered"], model: "claude-haiku-5-5", generatedAt: 1, basedOnAt });
    expect(await w.t.mutation(internal.comma.personSummaries.personSummaryPublish, { personId: w.personId, summary: summary(5, "Newer.") })).toBe(true);
    expect(await w.t.mutation(internal.comma.personSummaries.personSummaryPublish, { personId: w.personId, summary: summary(4, "Older.") })).toBe(false);
    const [person] = await w.t.mutation(internal.comma.agentContext.agentPeople, { conversationId: w.conversationId });
    expect(person?.summary).toBe("Newer.\n- Stage plot unanswered");
  });
});

describe("the agent pane's header", () => {
  test("names the person's platforms and lists their open threads on each, newest first", async () => {
    const w = await world();
    await w.post(inbound(w.conversationId, "m1", { dateCreated: Date.now() - 2 * MINUTE }));
    const slackDm = await w.t.run((ctx) => slackMessage(ctx, "dm", "s1", SLACK_ALEX));
    await w.t.run((ctx) => slackMessage(ctx, "channel", "s2", SLACK_ALEX));
    const header = await w.as.query(api.comma.personSummaries.get, { conversationId: w.conversationId });
    expect(header).toMatchObject({ personId: w.personId, name: "Alex Rivera", summary: null });
    expect([...header!.platforms].sort()).toEqual(["imessage", "slack"]);
    expect(header!.threads.map(({ conversationId, platform, state }) => [conversationId, platform, state])).toEqual([
      [slackDm, "slack", "needsYou"], [w.conversationId, "imessage", "needsYou"],
    ]);
    await expect(w.t.query(api.comma.personSummaries.get, { conversationId: w.conversationId })).rejects.toThrow("Unauthorized");
  });

  test("a group has no header", async () => {
    const w = await world();
    const channel = await w.t.run((ctx) => slackMessage(ctx, "channel", "s2", SLACK_ALEX));
    expect(await w.as.query(api.comma.personSummaries.get, { conversationId: channel })).toBeNull();
  });
});
