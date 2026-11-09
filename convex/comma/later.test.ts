import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { resurfaceOnMessages } from "./later";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.UTC(2026, 10, 9, 17) });
});
afterEach(() => {
  vi.useRealTimers();
});

type T = TestConvex<typeof schema>;
type ConversationId = Id<"comma_conversations">;

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const dm = (n: number) => t.run((ctx) => ctx.db.insert("comma_conversations", {
    conversationKey: `dm:+1555000${n}`, primaryChatGuid: `iMessage;-;+1555000${n}`, chatGuids: [`iMessage;-;+1555000${n}`],
    displayName: `Person ${n}`, isGroup: false, participants: [], lastMessageAt: 0, isSpam: false, hasGroupPhoto: false, updatedAt: 0,
  }));
  return { t, as: t.withIdentity({ subject: `${userId}|session` }), c: await dm(1), other: await dm(2) };
}

function ingest(t: T, c: ConversationId, guid: string, at: number, fromMe: boolean) {
  return t.mutation(internal.comma.internal.upsertMessages, {
    messages: [{
      guid, conversationId: c, chatGuid: `iMessage;-;${c}`, dateCreated: at, isFromMe: fromMe, text: guid, service: "iMessage" as const,
      error: 0, edited: false, retracted: false, isTapback: false, reactions: [], isGroupEvent: false, mentions: [],
      attachmentGuids: [], sourceVersion: 1,
    }],
  });
}

async function row(as: ReturnType<T["withIdentity"]>, c: ConversationId) {
  const conversation = await as.query(api.comma.queries.getConversation, { conversationId: c });
  if (!conversation) throw new Error("missing conversation");
  return conversation;
}

/** Runs the jobs due by now, after moving the clock `ms` forward. */
async function after(t: T, ms: number) {
  vi.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
}

describe("Later", () => {
  test("leaves every queue until its time, then comes back needing the user", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, "in-1", Date.now() - 1000, false);
    await t.run((ctx) => ctx.db.patch(c, { unread: { count: 1, firstAt: Date.now() - 1000 } }));
    expect((await row(as, c)).flags.unread).toBe(true);
    const until = Date.now() + HOUR;
    await as.mutation(api.comma.later.snooze, { conversationId: c, until });

    expect(await row(as, c)).toMatchObject({ flags: { unresponded: false, waiting: false, unread: false }, unreadCount: 0, later: { snoozedUntil: until } });
    expect((await as.query(api.comma.later.listSnoozed, {})).map((r) => r._id)).toEqual([c]);

    await after(t, HOUR - 1000);
    expect((await row(as, c)).later).toEqual({ snoozedUntil: until });

    await after(t, 1000);
    expect(await row(as, c)).toMatchObject({ flags: { unresponded: true }, later: { returned: { reason: "time", until } } });
    expect(await as.query(api.comma.later.listSnoozed, {})).toEqual([]);
  });

  test("comes back early on a new inbound message, and its wake then does nothing", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, "out-1", Date.now() - 1000, true);
    const until = Date.now() + DAY;
    await as.mutation(api.comma.later.snooze, { conversationId: c, until });
    // A backfilled message from before the snooze is not news.
    await ingest(t, c, "old", Date.now() - 500, false);
    expect((await row(as, c)).later).toEqual({ snoozedUntil: until });

    await after(t, HOUR);
    await ingest(t, c, "in-2", Date.now(), false);
    const returned = { reason: "message", until, at: Date.now() };
    expect(await row(as, c)).toMatchObject({ flags: { unresponded: true, waiting: false }, later: { returned } });

    await after(t, DAY);
    expect((await row(as, c)).later).toEqual({ returned });
  });

  test("a reply after it came back clears the reason; so does a settle", async () => {
    const { t, as, c, other } = await setup();
    await ingest(t, c, "in-1", Date.now() - 1000, false);
    await ingest(t, other, "in-a", Date.now() - 1000, false);
    for (const conversationId of [c, other]) await as.mutation(api.comma.later.snooze, { conversationId, until: Date.now() + HOUR });
    await after(t, HOUR);
    await ingest(t, c, "out-1", Date.now(), true);
    expect(await row(as, c)).toMatchObject({ flags: { unresponded: false, waiting: true } });
    expect((await row(as, c)).later).toBeUndefined();

    await as.mutation(api.comma.triage.settle, { conversationId: other });
    expect(await row(as, other)).toMatchObject({ flags: { unresponded: false, waiting: false } });
    expect((await row(as, other)).later).toBeUndefined();
  });

  test("settling a snoozed conversation ends the snooze for good", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, "in-1", Date.now() - 1000, false);
    await as.mutation(api.comma.later.snooze, { conversationId: c, until: Date.now() + HOUR });
    await as.mutation(api.comma.triage.settle, { conversationId: c, anchor: "in-1" });
    await after(t, HOUR);
    expect(await row(as, c)).toMatchObject({ flags: { unresponded: false, waiting: false } });
    expect((await row(as, c)).later).toBeUndefined();
  });

  test("unsnooze, the undo, puts it straight back and cancels the wake", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, "in-1", Date.now() - 1000, false);
    await as.mutation(api.comma.later.snooze, { conversationId: c, until: Date.now() + HOUR });
    await as.mutation(api.comma.later.unsnooze, { conversationId: c });
    expect(await row(as, c)).toMatchObject({ flags: { unresponded: true } });
    await after(t, HOUR);
    expect((await row(as, c)).later).toBeUndefined();
  });

  test("lists keep a snoozed conversation but count it in no queue", async () => {
    const { t, as, c, other } = await setup();
    await ingest(t, c, "in-1", Date.now() - 2000, false);
    await ingest(t, other, "in-a", Date.now() - 1000, false);
    await as.mutation(api.comma.later.snooze, { conversationId: c, until: Date.now() + HOUR });
    const { page } = await as.query(api.comma.queries.listConversations, { paginationOpts: { numItems: 10, cursor: null } });
    expect(page.map((r) => [r._id, r.flags.unresponded])).toEqual([[other, true], [c, false]]);
    expect(page.filter((r) => r.flags.unresponded || r.flags.waiting || r.flags.unread)).toHaveLength(1);
  });

  test("refuses a time already past", async () => {
    const { as, c } = await setup();
    await expect(as.mutation(api.comma.later.snooze, { conversationId: c, until: Date.now() })).rejects.toThrow("future");
  });

  test("a Slack channel's chatter does not end it early; an @-mention does", async () => {
    const { t, as } = await setup();
    const channel = await t.run((ctx) => ctx.db.insert("comma_conversations", {
      conversationKey: "slack:C1", platform: "slack", kind: "channel", slack: { channel: "C1" }, chatGuids: [], displayName: "#ops",
      isGroup: true, participants: [], lastMessageAt: 0, isSpam: false, hasGroupPhoto: false, updatedAt: 0,
    }));
    await as.mutation(api.comma.later.snooze, { conversationId: channel, until: Date.now() + DAY });
    const message = (mentionsMe: boolean) => ({ conversationId: channel, dateCreated: Date.now(), isFromMe: false, mentionsMe });
    vi.advanceTimersByTime(1000);
    await t.run((ctx) => resurfaceOnMessages(ctx, [message(false)]));
    expect((await row(as, channel)).later).toEqual({ snoozedUntil: Date.now() + DAY - 1000 });
    await t.run((ctx) => resurfaceOnMessages(ctx, [message(true)]));
    expect((await row(as, channel)).later?.returned?.reason).toBe("message");
  });
});

describe("Follow up", () => {
  test("at its time with no reply, moves from Waiting to needing the user", async () => {
    const { t, as, c } = await setup();
    const sentAt = Date.now() - 1000;
    await ingest(t, c, "out-1", sentAt, true);
    const at = Date.now() + 2 * DAY;
    await as.mutation(api.comma.later.setFollowUp, { conversationId: c, at });
    expect(await row(as, c)).toMatchObject({ flags: { waiting: true, unresponded: false }, later: { followUp: { at, since: sentAt, due: false } } });

    await after(t, 2 * DAY);
    expect(await row(as, c)).toMatchObject({ flags: { waiting: false, unresponded: true }, later: { followUp: { at, since: sentAt, due: true } } });

    // Settling it handles the reminder.
    await as.mutation(api.comma.triage.settle, { conversationId: c, anchor: "out-1" });
    expect(await row(as, c)).toMatchObject({ flags: { waiting: false, unresponded: false } });
    expect((await row(as, c)).later).toBeUndefined();
  });

  test("a reply cancels it, and its time then does nothing", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, "out-1", Date.now() - 1000, true);
    await as.mutation(api.comma.later.setFollowUp, { conversationId: c, at: Date.now() + 2 * DAY });
    await after(t, DAY);
    await ingest(t, c, "in-1", Date.now(), false);
    expect((await row(as, c)).later).toBeUndefined();
    await after(t, 2 * DAY);
    expect((await row(as, c)).later).toBeUndefined();
  });

  test("outlives a settle while it waits, and clearFollowUp takes it back", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, "out-1", Date.now() - 1000, true);
    await as.mutation(api.comma.later.setFollowUp, { conversationId: c, at: Date.now() + HOUR });
    await as.mutation(api.comma.triage.settle, { conversationId: c, anchor: "out-1" });
    expect((await row(as, c)).later?.followUp?.due).toBe(false);
    await as.mutation(api.comma.later.clearFollowUp, { conversationId: c });
    await after(t, HOUR);
    expect(await row(as, c)).toMatchObject({ flags: { waiting: false, unresponded: false } });
    expect((await row(as, c)).later).toBeUndefined();
  });

  test("needs the user's own message to be last", async () => {
    const { t, as, c } = await setup();
    await ingest(t, c, "in-1", Date.now() - 1000, false);
    await expect(as.mutation(api.comma.later.setFollowUp, { conversationId: c, at: Date.now() + HOUR })).rejects.toThrow("your message");
  });
});
