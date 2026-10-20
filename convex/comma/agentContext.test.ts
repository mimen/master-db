import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

import { commaModules } from "./testModules.vitest";

const modules = { ...commaModules, "../../comma/agentContext.ts": () => import("./agentContext") };
const ALEX = "+15550001111";
const SAM = "sam@example.com";

function message(conversationId: Id<"comma_conversations">, guid: string, dateCreated: number, fields: Partial<Doc<"comma_messages">> = {}) {
  return {
    guid, conversationId, chatGuid: "chat", dateCreated, isFromMe: false, text: guid, service: "iMessage" as const, error: 0,
    edited: false, retracted: false, isTapback: false, reactions: [], isGroupEvent: false, mentions: [], attachmentGuids: [],
    sourceVersion: 0, sender: { address: ALEX, name: null }, ...fields,
  };
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = new Date(0).toISOString();
    const personId = await ctx.db.insert("people", {
      display_name: "Alex Rivera", normalized_phones: [ALEX, "+15559990000"], normalized_emails: ["alex@example.com"],
      notes: "Runs the door", is_favorite: true, priority: 2, organization: "AUF", created_at: now, updated_at: now,
      identity_count: 1, message_count: 0, is_self: false, auto_clustered: false,
    });
    await ctx.db.insert("identities", {
      person_id: personId, kind: "phone", value: ALEX, normalized: ALEX, message_count: 0, chat_count: 0, is_self: false,
      source: "participant", created_at: now, updated_at: now,
    });
    await ctx.db.insert("tags", { person_id: personId, tag: "door", created_at: now });
    await ctx.db.insert("event_links", { person_id: personId, airtable_event_id: "rec1", event_name: "Sunset", created_at: now });
    const conversationId = await ctx.db.insert("comma_conversations", {
      conversationKey: "group", primaryChatGuid: "chat", chatGuids: ["chat"], displayName: "Door crew", isGroup: true,
      participants: [{ address: ALEX, name: "alex?" }, { address: SAM, name: null }],
      lastMessageAt: 1, isSpam: false, hasGroupPhoto: false, updatedAt: 1,
    });
    const storageId = await ctx.storage.store(new Blob(["png"], { type: "image/png" }));
    await ctx.db.insert("comma_attachments", {
      guid: "att1", conversationId, messageGuid: "m2", isSticker: false, hideAttachment: false, isOnDisk: true, sourceVersion: 1,
      originalStorageId: storageId, mimeType: "image/png", transferName: "door.png",
    });
    await ctx.db.insert("comma_messages", message(conversationId, "m1", 10, { text: "the door code is 4411" }));
    await ctx.db.insert("comma_messages", message(conversationId, "m2", 20, { attachmentGuids: ["att1"], sender: { address: SAM, name: null } }));
    await ctx.db.insert("comma_messages", message(conversationId, "tapback", 25, { isTapback: true }));
    await ctx.db.insert("comma_messages", message(conversationId, "m3", 30, { isFromMe: true, sender: undefined }));
    await ctx.db.insert("comma_messages", message(conversationId, "m4", 40));
    return { conversationId, personId };
  });
  return { t, ...ids };
}

describe("agentContext", () => {
  test("returns the newest messages newest-last with contact names and attachments", async () => {
    const { t, conversationId } = await setup();
    const context = await t.mutation(internal.comma.agentContext.agentContext, { conversationId, limit: 3 });
    expect(context.title).toBe("Door crew");
    expect(context.participants).toEqual([
      { name: "Alex Rivera", handles: [ALEX, "+15559990000", "alex@example.com"] },
      { name: SAM, handles: [SAM] },
    ]);
    expect(context.messages).toEqual([
      { guid: "m2", at: 20, fromMe: false, sender: SAM, text: "m2", attachments: [{ guid: "att1", name: "door.png", mime: "image/png" }] },
      { guid: "m3", at: 30, fromMe: true, sender: "Me", text: "m3", attachments: [] },
      { guid: "m4", at: 40, fromMe: false, sender: "Alex Rivera", text: "m4", attachments: [] },
    ]);
  });

  test("bounds are exclusive on both sides", async () => {
    const { t, conversationId } = await setup();
    const guids = async (bounds: { sinceMessageAt?: number; beforeMessageAt?: number }) =>
      (await t.mutation(internal.comma.agentContext.agentContext, { conversationId, limit: 40, ...bounds })).messages.map(({ guid }) => guid);
    expect(await guids({ sinceMessageAt: 20 })).toEqual(["m3", "m4"]);
    expect(await guids({ beforeMessageAt: 30 })).toEqual(["m1", "m2"]);
    expect(await guids({ sinceMessageAt: 10, beforeMessageAt: 40 })).toEqual(["m2", "m3"]);
    await expect(t.mutation(internal.comma.agentContext.agentContext, { conversationId, limit: 0 })).rejects.toThrow("limit");
  });
});

test("agentSearch finds thread messages in the agent's message shape", async () => {
  const { t, conversationId } = await setup();
  expect(await t.mutation(internal.comma.agentContext.agentSearch, { conversationId, query: "code" })).toEqual([
    { guid: "m1", at: 10, fromMe: false, sender: "Alex Rivera", text: "the door code is 4411", attachments: [] },
  ]);
});

test("agentPeople returns each participant with their CRM fields", async () => {
  const { t, conversationId, personId } = await setup();
  expect(await t.mutation(internal.comma.agentContext.agentPeople, { conversationId })).toEqual([
    {
      address: ALEX, name: "Alex Rivera", handles: [ALEX, "+15559990000", "alex@example.com"], personId,
      notes: "Runs the door", is_favorite: true, priority: 2, organization: "AUF", tags: ["door"],
      events: [{ airtable_event_id: "rec1", event_name: "Sunset" }],
    },
    { address: SAM, name: SAM, handles: [SAM], tags: [], events: [] },
  ]);
});

test("agentAttachment returns a storage URL with the file's name and type", async () => {
  const { t } = await setup();
  expect(await t.mutation(internal.comma.agentContext.agentAttachment, { guid: "att1" })).toEqual({
    url: expect.stringMatching(/^https?:/), name: "door.png", mime: "image/png",
  });
  expect(await t.mutation(internal.comma.agentContext.agentAttachment, { guid: "nope" })).toBeNull();
});
