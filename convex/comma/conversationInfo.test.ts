import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "../_generated/api";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";

import { commaModules } from "./testModules.vitest";

async function fixture(isGroup = false, rawDisplayName = "") {
  const t = convexTest(schema, commaModules).withIdentity({ email: ALLOWED_EMAIL });
  const ids = await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      display_name: "Current Name", normalized_phones: ["+16195551234"], normalized_emails: [],
      identity_count: 1, message_count: 0, is_self: false, auto_clustered: false,
      is_favorite: true, created_at: "before", updated_at: "before",
    });
    await ctx.db.insert("identities", { person_id: personId, kind: "phone", value: "+16195551234",
      normalized: "+16195551234", source: "manual", is_self: false,
      message_count: 0, chat_count: 0, created_at: "before", updated_at: "before" });
    const conversationId = await ctx.db.insert("comma_conversations", {
      conversationKey: isGroup ? "g:group" : "dm:+16195551234",
      primaryChatGuid: "SMS;-;+16195551234", chatGuids: ["SMS;-;+16195551234", "iMessage;-;+16195551234"],
      displayName: "Stale Name", rawDisplayName, isGroup,
      participants: [{ address: "+16195551234 (smsfp)", name: "Stale Name" }],
      lastMessageAt: 0, hasGroupPhoto: false, isSpam: false, updatedAt: 0,
    });
    for (const service of ["SMS", "iMessage"]) await ctx.db.insert("comma_chat_aliases", {
      chatGuid: `${service};-;+16195551234`, conversationId, service,
    });
    return { conversationId, personId };
  });
  return { t, ...ids };
}

test("findChat normalizes addresses, respects service choice and resolves sibling aliases", async () => {
  const { t } = await fixture();
  expect(await t.query(api.comma.conversationInfo.findChat, { address: " (619) 555-1234 " }))
    .toMatchObject({ chatGuid: "SMS;-;+16195551234", service: "SMS", isGroup: false });
  expect(await t.query(api.comma.conversationInfo.findChat, { address: "+16195551234 (iMessage)", service: "iMessage" }))
    .toMatchObject({ chatGuid: "iMessage;-;+16195551234", service: "iMessage", participants: ["+16195551234 (smsfp)"] });
  expect(await t.query(api.comma.conversationInfo.chatInfo, { chatGuid: "iMessage;-;+16195551234" }))
    .toMatchObject({ guid: "iMessage;-;+16195551234", participants: [{ name: "Current Name", is_favorite: true }] });
  expect(await t.query(api.comma.conversationInfo.findChat, { address: "missing@example.com" })).toBeNull();
  expect(await t.query(api.comma.conversationInfo.chatInfo, { chatGuid: "missing" })).toBeNull();
});

test("findChat excludes groups even with one participant and reports a missing service", async () => {
  const { t, conversationId } = await fixture();
  await t.run(async (ctx) => {
    await ctx.db.patch(conversationId, { isGroup: true });
  });
  expect(await t.query(api.comma.conversationInfo.findChat, { address: "+16195551234" })).toBeNull();
  await t.run(async (ctx) => {
    await ctx.db.patch(conversationId, { isGroup: false });
    const aliases = await ctx.db.query("comma_chat_aliases").collect();
    for (const alias of aliases) if (alias.service === "SMS") await ctx.db.delete(alias._id);
  });
  expect(await t.query(api.comma.conversationInfo.findChat, { address: "+16195551234", service: "SMS" })).toBeNull();
});

test("chatInfo returns the nullable raw group name and reads a rename live", async () => {
  const { t, personId, conversationId } = await fixture(true);
  const args = { chatGuid: "SMS;-;+16195551234" };
  expect(await t.query(api.comma.conversationInfo.chatInfo, args)).toMatchObject({ displayName: null, isGroup: true });
  await t.run(async (ctx) => {
    await ctx.db.patch(personId, { display_name: "Renamed Today" });
    await ctx.db.patch(conversationId, { rawDisplayName: "Raw group title" });
  });
  expect(await t.query(api.comma.conversationInfo.chatInfo, args)).toMatchObject({
    displayName: "Raw group title", participants: [{ name: "Renamed Today" }],
  });
  const view = await t.query(api.comma.queries.resolveChat, args);
  expect(view?.participants[0].name).toBe("Renamed Today");
});

test("conversation info queries reject unauthenticated callers", async () => {
  const t = convexTest(schema, commaModules);
  await expect(t.query(api.comma.conversationInfo.findChat, { address: "+16195551234" })).rejects.toThrow("Unauthorized");
  await expect(t.query(api.comma.conversationInfo.chatInfo, { chatGuid: "missing" })).rejects.toThrow("Unauthorized");
});

test("findChat normalizes email case and service suffixes without crossing addresses", async () => {
  const { t, conversationId } = await fixture();
  await t.run((ctx) => ctx.db.patch(conversationId, { conversationKey: "dm:friend@example.com", participants: [{ address: "friend@example.com", name: null }] }));
  expect(await t.query(api.comma.conversationInfo.findChat, { address: " FRIEND@EXAMPLE.COM (iMessage) " })).toMatchObject({ participants: ["friend@example.com"] });
  expect(await t.query(api.comma.conversationInfo.findChat, { address: "friend@another.example" })).toBeNull();
});
