import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { FunctionArgs, FunctionReturnType, StorageActionWriter } from "convex/server";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import type { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";

import { listConversations } from "./queries";
import { commaModules } from "./testModules.vitest";

type Args = FunctionArgs<typeof api.comma.queries.listConversations>;
type Result = FunctionReturnType<typeof api.comma.queries.listConversations>;
const handler = (listConversations as typeof listConversations & {
  _handler: (ctx: QueryCtx, args: Args) => Promise<Result>;
})._handler;

const phone = (i: number) => `+1619555${1000 + i}`;
const email = (i: number) => `p${i}@example.com`;

// 100 conversations: 60 phone DMs, 15 email DMs whose person also has a phone DM,
// 5 DMs with unknown handles, and 20 groups of five drawn from the same 60 people,
// each group's last message inbound from a member (half carry the BlueBubbles service suffix).
async function seed(ctx: MutationCtx & { storage: StorageActionWriter }) {
  const people: Id<"people">[] = [];
  for (let i = 0; i < 60; i++) {
    const photoStorageId = i % 2 === 0 ? await ctx.storage.store(new Blob([`photo-${i}`])) : undefined;
    const personId = await ctx.db.insert("people", {
      display_name: `Person ${i}`, normalized_phones: [phone(i)], normalized_emails: i < 15 ? [email(i)] : [],
      identity_count: i < 15 ? 2 : 1, message_count: 0, is_self: false, auto_clustered: false,
      created_at: "x", updated_at: "x",
      ...(photoStorageId ? { photoStorageId } : {}),
      ...(i % 5 === 0 ? { is_favorite: true, priority: 3 } : {}),
    });
    people.push(personId);
    const identity = { person_id: personId, source: "manual", is_self: false, message_count: 0, chat_count: 0, created_at: "x", updated_at: "x" };
    await ctx.db.insert("identities", { ...identity, kind: "phone", value: phone(i), normalized: phone(i) });
    if (i < 15) await ctx.db.insert("identities", { ...identity, kind: "email", value: email(i), normalized: email(i) });
    if (i % 3 === 0) await ctx.db.insert("tags", { person_id: personId, tag: `tag-${i % 4}`, created_at: "x" });
  }
  let at = 1_000_000;
  const insert = async (key: string, isGroup: boolean, participants: string[], inbound: boolean, extra: {
    rawDisplayName?: string; groupPhotoStorageId?: Id<"_storage">;
  } = {}) => {
    at -= 1000;
    const chatGuid = `iMessage;${isGroup ? "+" : "-"};${key}`;
    const id = await ctx.db.insert("comma_conversations", {
      conversationKey: `${isGroup ? "g" : "dm"}:${key}`, primaryChatGuid: chatGuid, chatGuids: [chatGuid],
      displayName: key, isGroup, participants: participants.map((address) => ({ address, name: null })),
      lastMessage: { guid: `last-${key}`, text: "hi", dateCreated: at, isFromMe: !inbound, senderName: inbound ? "Mirrored" : null, hasAttachments: false },
      lastMessageAt: at, isSpam: false, hasGroupPhoto: extra.groupPhotoStorageId !== undefined, updatedAt: at,
      unread: inbound ? { count: 2, firstAt: at - 10 } : undefined,
      ...extra,
    });
    if ((at / 1000) % 2 === 0) {
      await ctx.db.insert("comma_conversation_state", { conversationId: id, mutedUnresponded: false, markedUnread: false,
        pinned: (at / 1000) % 6 === 0, readAt: (at / 1000) % 4 === 0 ? at : 0, updatedAt: at });
    }
    return { id, chatGuid };
  };
  for (let g = 0; g < 20; g++) {
    const members = [0, 1, 2, 3, 4].map((k) => phone((g * 3 + k * 7) % 60));
    const groupPhotoStorageId = g % 2 === 0 ? await ctx.storage.store(new Blob([`group-${g}`])) : undefined;
    const { id, chatGuid } = await insert(`group-${g}`, true, [...members, `+1858000${g}`], true,
      { ...(g % 3 === 0 ? {} : { rawDisplayName: "" }), ...(groupPhotoStorageId ? { groupPhotoStorageId } : {}) });
    await ctx.db.insert("comma_messages", {
      conversationId: id, guid: `last-group-${g}`, chatGuid, dateCreated: at, isFromMe: false, text: "hi",
      service: "iMessage", error: 0, edited: false, retracted: false, isTapback: false, reactions: [],
      isGroupEvent: false, mentions: [], attachmentGuids: [], sourceVersion: 1,
      sender: { address: g % 2 === 0 ? `${members[g % 5]} (smsfp)` : members[g % 5], name: "Mirrored" },
    });
    if (g % 4 === 0) {
      await ctx.db.insert("chat_crm", { chat_guid: chatGuid, priority: 2, created_at: "x", updated_at: "x" });
      await ctx.db.insert("tags", { chat_guid: chatGuid, tag: "crew", created_at: "x" });
    }
  }
  for (let i = 0; i < 60; i++) await insert(`dm-${i}`, false, [phone(i)], i % 2 === 0);
  for (let i = 0; i < 15; i++) await insert(`dm-mail-${i}`, false, [email(i)], i % 2 === 1);
  for (let i = 0; i < 5; i++) await insert(`dm-unknown-${i}`, false, [`+1760000${i}`], true);
}

type Tally = Record<string, number>;

// Counts each index lookup or db.get as one read, documents returned separately, and storage.getUrl calls.
function counting(ctx: MutationCtx, lookups: Tally, docs: Tally): QueryCtx {
  const bump = (tally: Tally, key: string, n = 1) => { tally[key] = (tally[key] ?? 0) + n; };
  const wrap = <T extends object>(table: string, target: T): T => new Proxy(target, {
    get(inner, property) {
      const value: unknown = Reflect.get(inner, property);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const out: unknown = value.apply(inner, args);
        if (property === "withIndex" || property === "order" || property === "filter") return wrap(table, out as object);
        if (["unique", "first", "collect", "take", "paginate"].includes(String(property))) {
          bump(lookups, table);
          return (out as Promise<unknown>).then((result) => {
            const rows = Array.isArray(result) ? result
              : result && typeof result === "object" && "page" in result ? (result as { page: unknown[] }).page
              : result ? [result] : [];
            bump(docs, table, rows.length);
            return result;
          });
        }
        return out;
      };
    },
  });
  const db = new Proxy(ctx.db, {
    get(target, property) {
      if (property === "query") return (table: Parameters<typeof target.query>[0]) => wrap(table, target.query(table));
      if (property === "get") return async (id: string) => {
        const table = `${id.split(";")[1]}.get`; // convex-test ids are "<n>;<table>"
        bump(lookups, table);
        const doc = await target.get(id as Id<"people">);
        if (doc) bump(docs, table);
        return doc;
      };
      return Reflect.get(target, property);
    },
  });
  const storage = new Proxy(ctx.storage, {
    get(target, property) {
      if (property === "getUrl") return (id: Id<"_storage">) => { bump(lookups, "storage.getUrl"); return target.getUrl(id); };
      return Reflect.get(target, property);
    },
  });
  return { ...ctx, db, storage } as QueryCtx;
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(1_700_000_000_000); });
afterAll(() => vi.useRealTimers());

test("listConversations reads per page on a 100-conversation inbox, with byte-identical output", async () => {
  const t = convexTest(schema, commaModules).withIdentity({ email: ALLOWED_EMAIL });
  await t.run(seed);
  const page = (numItems: number, cursor: string | null) => t.run(async (ctx) => {
    const lookups: Tally = {};
    const docs: Tally = {};
    const result = await handler(counting(ctx, lookups, docs), { paginationOpts: { numItems, cursor } });
    return { result, lookups, docs };
  });
  const first = await page(25, null);
  const rest = await page(100, first.result.continueCursor);
  expect(first.result.page).toHaveLength(25);
  expect(rest.result.page).toHaveLength(75);
  expect(rest.result.isDone).toBe(true);

  const timings: number[] = [];
  for (let run = 0; run < 15; run++) {
    const started = performance.now();
    await page(100, null);
    timings.push(performance.now() - started);
  }
  const all = await page(100, null);
  if (process.env.COMMA_READS_REPORT) {
    console.warn(JSON.stringify({ first25: first.lookups, rest75: rest.lookups, all100: all.lookups, docs100: all.docs,
      medianMs100: timings.sort((a, b) => a - b)[7] }, null, 2));
  }

  // Both digests were recorded from the unmemoized implementation at e357f707 on this seed.
  expect([digest(first.result), digest(rest.result)]).toEqual([
    "e8a59081b66fe61fe869bc0622249b0d1a0ffa009b2bde9db2566a7d7528b720",
    "c9e7938810a8ea774be169818f1c13135455807f1a8a128459aa911a3edf9dbc",
  ]);
  // e357f707 made 110 identity lookups, 85 people gets, 95 tag reads and 98 getUrl calls here.
  expect(all.lookups).toEqual({
    chat_crm: 20, comma_conversation_state: 100, comma_conversations: 1, comma_messages: 20,
    identities: 100, "people.get": 60, "storage.getUrl": 40, tags: 80,
  });
});
