import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api } from "../_generated/api";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function slackConversation() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const conversationId = await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("comma_accounts", {
      platform: "slack", externalId: "T066U9Q8F99", label: "AUF", selfHandles: ["slack:U1"], health: "ok", createdAt: 1,
    });
    return await ctx.db.insert("comma_conversations", {
      platform: "slack", accountId, conversationKey: "im:D1", slack: { channel: "D1" }, kind: "dm",
      displayName: "Sam", isGroup: false, participants: [{ address: "slack:U2", name: null }], lastMessageAt: 1, isSpam: false, updatedAt: 1,
    });
  });
  return { t, as: t.withIdentity({ subject: `${userId}|session` }), conversationId };
}

describe("the Slack lane", () => {
  test("refuses a send at enqueue, so no bubble or row appears", async () => {
    const { t, as, conversationId } = await slackConversation();
    await expect(as.mutation(api.comma.outbox.enqueue, { clientKey: "s1", conversationId, payload: { kind: "send", text: "hi" } }))
      .rejects.toThrow("Sending from Slack is coming");
    expect(await t.run((ctx) => ctx.db.query("comma_outbox").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("comma_messages").collect())).toEqual([]);
  });

  test("a read stays in Comma: the receipt runs in Convex and completes without calling Slack", async () => {
    const { t, as, conversationId } = await slackConversation();
    const fetch = vi.spyOn(globalThis, "fetch");
    await as.mutation(api.comma.triage.markRead, { conversationId, at: 5 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [row] = await t.run((ctx) => ctx.db.query("comma_outbox").collect());
    expect(row).toMatchObject({ lane: "slack", status: "sent", route: { platform: "slack", channel: "D1" }, result: { kind: "markRead", ok: true } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
