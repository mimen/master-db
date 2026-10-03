import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";

import { api } from "../_generated/api";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
afterEach(() => vi.restoreAllMocks());

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  const conversationId = await t.run((ctx) => ctx.db.insert("comma_conversations", {
    conversationKey: "dm:+15550001111",
    primaryChatGuid: "iMessage;-;+15550001111",
    chatGuids: ["iMessage;-;+15550001111"],
    displayName: "Alex",
    isGroup: false,
    participants: [],
    lastMessageAt: 1,
    isSpam: false,
    hasGroupPhoto: false,
    updatedAt: 1,
  }));
  return { t, as: t.withIdentity({ subject: `${userId}|session` }), conversationId };
}

test("upserts one draft and the last write gets the server timestamp", async () => {
  const { t, as, conversationId } = await setup();
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "first" });
  const first = await as.query(api.comma.queries.getDraft, { conversationId });
  expect(first).toMatchObject({ text: "first", updatedAt: 1000 });
  clock.mockReturnValue(2000);
  await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "second" });
  const second = await as.query(api.comma.queries.getDraft, { conversationId });
  expect(second).toMatchObject({ _id: first?._id, text: "second", updatedAt: 2000 });
  expect(await t.run((ctx) => ctx.db.query("comma_drafts").collect())).toHaveLength(1);
});

test("empty text and explicit clear delete the row, including repeated clears", async () => {
  const { as, conversationId } = await setup();
  for (const clear of [
    () => as.mutation(api.comma.drafts.setDraft, { conversationId, text: "" }),
    () => as.mutation(api.comma.drafts.clearDraft, { conversationId }),
  ]) {
    await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "draft" });
    await clear();
    await clear();
    expect(await as.query(api.comma.queries.getDraft, { conversationId })).toBeNull();
  }
});

test("draft reads and writes reject unauthenticated and disallowed users", async () => {
  const { t, conversationId } = await setup();
  const otherId = await t.run((ctx) => ctx.db.insert("users", { email: "other@example.com" }));
  for (const caller of [t, t.withIdentity({ subject: `${otherId}|session` })]) {
    await expect(caller.mutation(api.comma.drafts.setDraft, { conversationId, text: "no" })).rejects.toThrow("Unauthorized");
    await expect(caller.mutation(api.comma.drafts.clearDraft, { conversationId })).rejects.toThrow("Unauthorized");
    await expect(caller.query(api.comma.queries.getDraft, { conversationId })).rejects.toThrow("Unauthorized");
  }
});

test("only a new send clears its conversation draft, retries preserve the next draft", async () => {
  const { as, conversationId } = await setup();
  await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "draft" });
  await as.mutation(api.comma.outbox.enqueue, {
    clientKey: "pin", conversationId, payload: { kind: "pin", value: true },
  });
  expect(await as.query(api.comma.queries.getDraft, { conversationId })).toMatchObject({ text: "draft" });
  const args = { clientKey: "send", conversationId, payload: { kind: "send" as const, text: "draft" } };
  await as.mutation(api.comma.outbox.enqueue, args);
  expect(await as.query(api.comma.queries.getDraft, { conversationId })).toBeNull();
  await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "next" });
  await as.mutation(api.comma.outbox.enqueue, args);
  expect(await as.query(api.comma.queries.getDraft, { conversationId })).toMatchObject({ text: "next" });
});
