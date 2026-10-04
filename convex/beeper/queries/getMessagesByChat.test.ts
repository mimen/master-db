import { makeFunctionReference, type PaginationOptions, type PaginationResult } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import schema from "../../schema";
import { normalizeModules } from "../../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../../**/*.*s"), import.meta.url);
const chat_id = "!room:beeper.local";
const getMessagesByChat = makeFunctionReference<
  "query",
  { chat_id: string; paginationOpts: PaginationOptions },
  PaginationResult<{ message_id: string }>
>("beeper/queries/getMessagesByChat:getMessagesByChat");

test("paging backwards returns every message once, even when timestamps tie", async () => {
  const t = convexTest(schema, modules);
  const stamps = [1000, 2000, 2000, 2000, 3000];
  await t.run(async (ctx) => {
    for (const [i, ts] of stamps.entries()) {
      await ctx.db.insert("beeper_messages", {
        account_id: "whatsapp", network: "whatsapp", chat_id, message_id: `m${i}`,
        is_sender: false, ts_epoch_ms: ts, text: `m${i}`, reactions: [], attachments: [],
        is_deleted: false, is_hidden: false, first_seen_at: "x", last_synced_at: "x",
      });
    }
  });

  const seen: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: PaginationResult<{ message_id: string }> = await t.query(getMessagesByChat, {
      chat_id,
      paginationOpts: { numItems: 2, cursor },
    });
    seen.push(...page.page.map((m) => m.message_id));
    if (page.isDone) break;
    cursor = page.continueCursor;
  }

  expect(seen).toHaveLength(stamps.length);
  expect(new Set(seen).size).toBe(stamps.length);
  expect(seen[0]).toBe("m4");
  expect(seen[seen.length - 1]).toBe("m0");
});
