import { convexTest } from "convex-test";
import { beforeEach, expect, test } from "vitest";

import { internal } from "../_generated/api";
import { ALLOWED_EMAIL } from "../_lib/authed";
import { listPeopleRef, TEST_KEY, whoIsRef } from "../identity/testRefs.vitest";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const hash = "a".repeat(64);
beforeEach(() => { process.env.IMSG_IDENTITY_KEY = TEST_KEY; });

async function fixture(address = "+16195551234") {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      display_name: "Photo Person", normalized_phones: [address], normalized_emails: [],
      identity_count: 1, message_count: 0, is_self: false, auto_clustered: true,
      created_at: "before", updated_at: "before",
    });
    const identity = { kind: "phone", value: address, normalized: address,
      message_count: 0, chat_count: 0, is_self: false, source: "apple_contact",
      created_at: "before", updated_at: "before" };
    await ctx.db.insert("identities", identity);
    await ctx.db.insert("identities", { ...identity, person_id: personId });
    const storageId = await ctx.storage.store(new Blob(["photo"], { type: "image/jpeg" }));
    return { personId, storageId, photoUrl: await ctx.storage.getUrl(storageId) };
  });
  return { t, ...seeded };
}

test("sets the resolved person's photo, normalizes phones, and retries without rewriting", async () => {
  const { t, personId, storageId } = await fixture();
  const args = { address: "(619) 555-1234", storageId, hash };
  expect(await t.mutation(internal.comma.photos.setContactPhoto, args)).toBe(true);
  const person = await t.run((ctx) => ctx.db.get(personId));
  expect(person).toMatchObject({ photoStorageId: storageId, photoHash: hash, display_name: "Photo Person" });
  expect(await t.mutation(internal.comma.photos.setContactPhoto, args)).toBe(true);
  expect(await t.run((ctx) => ctx.db.get(personId))).toEqual(person);
  const replacement = await t.run((ctx) => ctx.storage.store(new Blob(["new photo"])));
  expect(await t.mutation(internal.comma.photos.setContactPhoto, { ...args, storageId: replacement, hash: "b".repeat(64) })).toBe(true);
  expect(await t.run((ctx) => ctx.db.get(personId))).toMatchObject({ photoStorageId: replacement, photoHash: "b".repeat(64) });
});

test("normalizes email before phone-like digits in the email", async () => {
  const { t, personId, storageId } = await fixture("person6195551234@example.com");
  expect(await t.mutation(internal.comma.photos.setContactPhoto, {
    address: " PERSON6195551234@EXAMPLE.COM ", storageId, hash,
  })).toBe(true);
  expect(await t.run((ctx) => ctx.db.get(personId))).toMatchObject({ photoHash: hash });
});

test("unmatched addresses remain retryable and never create people", async () => {
  const { t, personId, storageId } = await fixture();
  const args = { address: "missing@example.com", storageId, hash };
  expect(await t.mutation(internal.comma.photos.setContactPhoto, args)).toBe(false);
  expect(await t.run((ctx) => ctx.db.query("people").collect())).toHaveLength(1);
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("identities").collect()).find((i) => i.person_id);
    await ctx.db.patch(row!._id, { normalized: args.address });
  });
  expect(await t.mutation(internal.comma.photos.setContactPhoto, args)).toBe(true);
  expect(await t.run((ctx) => ctx.db.get(personId))).toMatchObject({ photoHash: hash });
  await expect(t.mutation(internal.comma.photos.setContactPhoto, { ...args, hash: "bad" })).rejects.toThrow("Invalid photo SHA-256");
});

test("people and conversation queries expose photo URLs without changing stored participants", async () => {
  const { t, personId, storageId, photoUrl } = await fixture();
  expect(photoUrl).toBeTypeOf("string");
  await t.mutation(internal.comma.photos.setContactPhoto, { address: "6195551234", storageId, hash });
  expect(await t.query(whoIsRef, { key: TEST_KEY, handle: "+16195551234" })).toMatchObject({
    found: true, person: { _id: personId, photoUrl },
  });
  expect(await t.query(listPeopleRef, { key: TEST_KEY })).toMatchObject([{ _id: personId, photoUrl }]);
  const conversationId = await t.run((ctx) => ctx.db.insert("comma_conversations", {
    conversationKey: "dm:photo", primaryChatGuid: "photo", chatGuids: ["photo"], displayName: "Photos",
    isGroup: true, participants: [{ address: "+16195551234", name: "Photo Person" }, { address: "unknown@example.com", name: null }],
    lastMessage: { guid: "m1", text: "hello", dateCreated: 1, isFromMe: false, senderName: null, hasAttachments: false },
    lastMessageAt: 1, isSpam: false, hasGroupPhoto: false, updatedAt: 1,
  }));
  const { api } = await import("../_generated/api");
  const authed = t.withIdentity({ email: ALLOWED_EMAIL });
  const expected = [{ address: "+16195551234", name: "Photo Person", photoUrl }, { address: "unknown@example.com", name: null, photoUrl: null }];
  expect((await authed.query(api.comma.queries.getConversation, { conversationId }))?.participants).toEqual(expected);
  expect((await authed.query(api.comma.queries.listConversations, { paginationOpts: { numItems: 5, cursor: null } })).page[0].participants).toEqual(expected);
  expect((await t.run((ctx) => ctx.db.get(conversationId)))?.participants[0]).not.toHaveProperty("photoUrl");
});
