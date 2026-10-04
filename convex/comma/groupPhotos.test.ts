import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api, internal } from "../_generated/api";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";

import { commaModules } from "./testModules.vitest";

async function fixture(isGroup = true) {
  const t = convexTest(schema, commaModules).withIdentity({ email: ALLOWED_EMAIL });
  const id = await t.run(async (ctx) => {
    const id = await ctx.db.insert("comma_conversations", {
      conversationKey: "g:group", primaryChatGuid: "iMessage;+;group", chatGuids: ["iMessage;+;group", "SMS;+;group"],
      displayName: "Group", rawDisplayName: "Group", isGroup, participants: [], hasGroupPhoto: false,
      isSpam: false, lastMessageAt: 1, updatedAt: 1,
      lastMessage: { guid: "m", dateCreated: 1, text: "Hi", senderName: null, isFromMe: true, hasAttachments: false },
    });
    for (const service of ["iMessage", "SMS"]) await ctx.db.insert("comma_chat_aliases", { chatGuid: `${service};+;group`, service, conversationId: id });
    return id;
  });
  return { t, id };
}

test("links group photo storage, projects URLs through all conversation reads and clears a removed photo", async () => {
  const { t, id } = await fixture();
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["photo"], { type: "image/png" })));
  const photoUrl = await t.run((ctx) => ctx.storage.getUrl(storageId));
  expect(await t.mutation(internal.comma.groupPhotos.setGroupPhoto, { chatGuid: "SMS;+;group", guid: "photo-1", storageId })).toBe(true);
  expect(await t.query(api.comma.queries.resolveChat, { chatGuid: "iMessage;+;group" })).toMatchObject({ groupPhotoGuid: "photo-1", groupPhotoUrl: photoUrl });
  expect(await t.query(api.comma.queries.getConversation, { conversationId: id })).toMatchObject({ groupPhotoUrl: photoUrl });
  const page = await t.query(api.comma.queries.listConversations, { paginationOpts: { numItems: 25, cursor: null } });
  expect(page.page[0].groupPhotoUrl).toBe(photoUrl);
  const replacement = await t.run((ctx) => ctx.storage.store(new Blob(["replacement"])));
  expect(await t.mutation(internal.comma.groupPhotos.setGroupPhoto, { chatGuid: "iMessage;+;group", guid: "photo-2", storageId: replacement })).toBe(true);
  expect((await t.query(api.comma.queries.getConversation, { conversationId: id }))?.groupPhotoUrl).not.toBe(photoUrl);
  expect(await t.mutation(internal.comma.groupPhotos.setGroupPhoto, { chatGuid: "iMessage;+;group", guid: null })).toBe(true);
  const cleared = await t.query(api.comma.queries.getConversation, { conversationId: id });
  expect(cleared?.groupPhotoUrl).toBeNull();
  expect(cleared?.hasGroupPhoto).toBe(false);
  expect(await t.run((ctx) => ctx.db.get(id))).not.toHaveProperty("groupPhotoGuid");
});

test("rejects incomplete storage references and leaves DMs or missing chats alone", async () => {
  const { t } = await fixture(false);
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["photo"])));
  expect(await t.mutation(internal.comma.groupPhotos.setGroupPhoto, { chatGuid: "iMessage;+;group", guid: "p", storageId })).toBe(false);
  expect(await t.mutation(internal.comma.groupPhotos.setGroupPhoto, { chatGuid: "missing", guid: "p", storageId })).toBe(false);
  await expect(t.mutation(internal.comma.groupPhotos.setGroupPhoto, { chatGuid: "missing", guid: "p" })).rejects.toThrow("both GUID and storage id");
  await expect(t.mutation(internal.comma.groupPhotos.setGroupPhoto, { chatGuid: "missing", guid: null, storageId })).rejects.toThrow("both GUID and storage id");
});
