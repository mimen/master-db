import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { internal } from "../../_generated/api";
import schema from "../../schema";
import { normalizeModules } from "../../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../../**/*.*s"), import.meta.url);
const chat_id = "!room:beeper.local";
const message = (message_id: string, text = "hi") => ({
  account_id: "whatsapp",
  network: "whatsapp",
  chat_id,
  message_id,
  timestamp: "2026-01-01T00:00:00Z",
  text,
});

test("message_count counts each message once across batches and re-ingests", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.beeper.internalMutations.upsertChat.upsertChat, {
    chat: { account_id: "whatsapp", network: "whatsapp", chat_id, type: "single", participants: [] },
  });
  const upsert = (messages: ReturnType<typeof message>[]) =>
    t.mutation(internal.beeper.internalMutations.upsertMessages.upsertMessages, { chat_id, messages });

  await upsert([message("m1"), message("m2")]);
  await upsert([message("m2", "edited"), message("m3")]);
  await upsert([message("m1")]);

  const chat = await t.run((ctx) =>
    ctx.db.query("beeper_chats").withIndex("by_chat_id", (q) => q.eq("chat_id", chat_id)).unique(),
  );
  expect(chat?.message_count).toBe(3);
});
