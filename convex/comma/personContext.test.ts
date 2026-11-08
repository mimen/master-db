import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

import { commaModules } from "./testModules.vitest";

const modules = { ...commaModules, "../../comma/agentContext.ts": () => import("./agentContext") };
const ALEX = "+15550001111";
const ALEX_EMAIL = "alex@example.com";
const SAM = "sam@example.com";
const STRANGER = "+15550009999";

type Conversation = Partial<Doc<"comma_conversations">> & { conversationKey: string; participants: { address: string; name: null }[] };

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const person = { normalized_phones: [ALEX], normalized_emails: [ALEX_EMAIL], identity_count: 2, message_count: 0, is_self: false,
      auto_clustered: false, created_at: "x", updated_at: "x" };
    const personId = await ctx.db.insert("people", { ...person, display_name: "Alex Rivera" });
    const mergedId = await ctx.db.insert("people", { ...person, normalized_phones: [], normalized_emails: [], merged_into: personId });
    const identity = { person_id: personId, message_count: 0, chat_count: 0, is_self: false, source: "manual", created_at: "x", updated_at: "x" };
    await ctx.db.insert("identities", { ...identity, kind: "phone", value: ALEX, normalized: ALEX });
    // The network's own spelling is what a message's sender carries.
    await ctx.db.insert("identities", { ...identity, kind: "email", value: "Alex@Example.com", normalized: ALEX_EMAIL });

    const conversation = (fields: Conversation) => ctx.db.insert("comma_conversations", {
      platform: "imessage", primaryChatGuid: fields.conversationKey, chatGuids: [], displayName: "stored", isGroup: false,
      lastMessageAt: 1, isSpam: false, hasGroupPhoto: false, updatedAt: 1, ...fields,
    });
    const dm = await conversation({ conversationKey: `dm:${ALEX}`, participants: [{ address: ALEX, name: null }] });
    const emailDm = await conversation({ conversationKey: `dm:${ALEX_EMAIL}`, participants: [{ address: "Alex@Example.com", name: null }] });
    const crew = await conversation({ conversationKey: "g:crew", isGroup: true, rawDisplayName: "Launch Crew",
      participants: [{ address: ALEX, name: null }, { address: SAM, name: null }] });
    const unnamed = await conversation({ conversationKey: "g:unnamed", isGroup: true, rawDisplayName: "",
      participants: [{ address: "Alex@Example.com", name: null }, { address: SAM, name: null }] });
    const samDm = await conversation({ conversationKey: `dm:${SAM}`, participants: [{ address: SAM, name: null }] });
    const strangerDm = await conversation({ conversationKey: `dm:${STRANGER}`, participants: [{ address: STRANGER, name: null }] });

    const message = (conversationId: Id<"comma_conversations">, guid: string, dateCreated: number, from: string | null, fields: Partial<Doc<"comma_messages">> = {}) =>
      ctx.db.insert("comma_messages", {
        guid, conversationId, chatGuid: "chat", dateCreated, isFromMe: from === null, text: guid, service: "iMessage", error: 0,
        edited: false, retracted: false, isTapback: false, reactions: [], isGroupEvent: false, mentions: [], attachmentGuids: [],
        sourceVersion: 0, ...(from === null ? {} : { sender: { address: from, name: null } }), ...fields,
      });
    await message(dm, "d1", 100, ALEX, { text: "this thread" });
    await message(dm, "d2", 110, null);
    await message(dm, "d3", 115, ALEX, { isTapback: true });
    await message(dm, "d4", 116, ALEX, { retracted: true });
    await message(emailDm, "e1", 105, null, { text: "see you" });
    await message(emailDm, "e2", 125, "Alex@Example.com", { text: "on my way now" });
    await message(crew, "g1", 120, ALEX, { text: "are you coming?" });
    await message(crew, "g2", 130, SAM);
    await message(crew, "g3", 135, null);
    await message(crew, "g4", 140, ALEX, { text: "", attachmentGuids: ["a1"] });
    await message(crew, "g5", 145, ALEX, { isGroupEvent: true });
    await message(unnamed, "u1", 90, "Alex@Example.com", { text: "old one" });
    await message(samDm, "s1", 150, SAM);
    await message(strangerDm, "x1", 50, STRANGER, { text: "who dis" });
    return { personId, mergedId, dm, emailDm, crew, unnamed, strangerDm };
  });
  const read = (args: { conversationId: Id<"comma_conversations">; personId?: Id<"people">; address?: string; sinceAt?: number; beforeAt?: number; limit?: number; maxChars?: number }) =>
    t.mutation(internal.comma.agentContext.agentPersonContext, { limit: 20, maxChars: 5000, ...args });
  return { t, read, ...ids };
}

const texts = (result: { lines: { text: string }[] } | null) => result?.lines.map(({ text }) => text);

describe("agentPersonContext", () => {
  test("a DM's person, everywhere else, newest first, with each line's conversation", async () => {
    const { read, dm, emailDm, crew, unnamed } = await setup();
    const result = await read({ conversationId: dm });
    expect(result).toEqual({
      name: "Alex Rivera",
      more: false,
      lines: [
        { at: 140, conversationId: crew, conversation: "Launch Crew", kind: "group", platform: "imessage", fromMe: false, sender: "Alex Rivera", text: "[an attachment]" },
        { at: 125, conversationId: emailDm, conversation: "Alex Rivera", kind: "dm", platform: "imessage", fromMe: false, sender: "Alex Rivera", text: "on my way now" },
        { at: 120, conversationId: crew, conversation: "Launch Crew", kind: "group", platform: "imessage", fromMe: false, sender: "Alex Rivera", text: "are you coming?" },
        { at: 105, conversationId: emailDm, conversation: "Alex Rivera", kind: "dm", platform: "imessage", fromMe: true, sender: "Me", text: "see you" },
        { at: 90, conversationId: unnamed, conversation: `Alex Rivera, ${SAM}`, kind: "group", platform: "imessage", fromMe: false, sender: "Alex Rivera", text: "old one" },
      ],
    });
  });

  test("a line reads the adapter's model text, and the character budget counts it", async () => {
    const { t, read, dm, crew } = await setup();
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("comma_messages").withIndex("by_conversation_date", (q) => q.eq("conversationId", crew).eq("dateCreated", 120)).unique())!;
      await ctx.db.patch(row._id, { text: `are you coming?\n> ${"quoted history ".repeat(100)}`, modelText: "are you coming?" });
    });
    const result = await read({ conversationId: dm, limit: 3, maxChars: 40 });
    expect(texts(result)).toContain("are you coming?");
  });

  test("pages by count, characters and time", async () => {
    const { read, dm } = await setup();
    expect(await read({ conversationId: dm, limit: 2 })).toMatchObject({ lines: [{ at: 140 }, { at: 125 }], more: true });
    expect(texts(await read({ conversationId: dm, limit: 2, beforeAt: 125 }))).toEqual(["are you coming?", "see you"]);
    expect(await read({ conversationId: dm, maxChars: 20 })).toMatchObject({ lines: [{ at: 140 }, { at: 125 }], more: true });
    expect(texts(await read({ conversationId: dm, maxChars: 1 }))).toEqual(["[an attachment]"]);
    expect(texts(await read({ conversationId: dm, sinceAt: 120 }))).toEqual(["[an attachment]", "on my way now"]);
  });

  test("a busy excluded thread costs no reads and hides nothing elsewhere", async () => {
    const { t, read, dm, crew } = await setup();
    await t.run(async (ctx) => {
      for (let n = 0; n < 500; n++) {
        await ctx.db.insert("comma_messages", {
          guid: `busy${n}`, conversationId: dm, chatGuid: "chat", dateCreated: 1_000 + n, isFromMe: false, text: "busy", service: "iMessage", error: 0,
          edited: false, retracted: false, isTapback: false, reactions: [], isGroupEvent: false, mentions: [], attachmentGuids: [],
          sourceVersion: 0, sender: { address: ALEX, name: null },
        });
      }
    });
    expect(await read({ conversationId: dm, limit: 1 })).toMatchObject({ lines: [{ conversationId: crew, at: 140 }], more: true });
  });

  test("a group names the person, and has none of its own", async () => {
    const { read, crew, personId, mergedId } = await setup();
    expect(await read({ conversationId: crew })).toBeNull();
    const everywhere = ["on my way now", "d2", "see you", "this thread", "old one"];
    expect(texts(await read({ conversationId: crew, address: ALEX }))).toEqual(everywhere);
    expect(texts(await read({ conversationId: crew, personId }))).toEqual(everywhere);
    expect(texts(await read({ conversationId: crew, personId: mergedId }))).toEqual(everywhere);
    await expect(read({ conversationId: crew, personId, address: ALEX })).rejects.toThrow("at most one");
    await expect(read({ conversationId: crew, limit: 0 })).rejects.toThrow("limit");
  });

  test("an address with no person still reads by that address", async () => {
    const { t, read } = await setup();
    const withStranger = await t.run((ctx) => ctx.db.insert("comma_conversations", {
      platform: "imessage", conversationKey: "g:stranger", primaryChatGuid: "g:stranger", chatGuids: [], displayName: "stored", isGroup: true,
      participants: [{ address: STRANGER, name: null }, { address: SAM, name: null }], lastMessageAt: 1, isSpam: false, hasGroupPhoto: false, updatedAt: 1,
    }));
    expect(await read({ conversationId: withStranger, address: STRANGER })).toMatchObject({
      name: "(555) 000-9999", lines: [{ text: "who dis", kind: "dm", sender: "(555) 000-9999" }],
    });
  });

  test("refuses a person who is not in this conversation", async () => {
    const { read, crew, strangerDm, personId } = await setup();
    await expect(read({ conversationId: crew, address: STRANGER })).rejects.toThrow("not in this conversation");
    await expect(read({ conversationId: strangerDm, personId })).rejects.toThrow("not in this conversation");
    await expect(read({ conversationId: strangerDm, address: ALEX_EMAIL })).rejects.toThrow("not in this conversation");
  });
});
