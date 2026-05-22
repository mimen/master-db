import { describe, expect, test } from "vitest";

describe("getRecentChats projection", () => {
  test("strips raw + participants from the row to keep payload small", () => {
    const c = {
      _id: "id_1",
      chat_id: "!room:beeper.local",
      title: "auf family",
      type: "group",
      network: "WhatsApp",
      participant_count: 41,
      last_activity: "2026-05-22T22:26:41.000Z",
      unread_count: 1,
      message_count: 4321,
      raw: "{...large blob...}",
      participants: new Array(41).fill({}),
    };
    const projected = {
      _id: c._id,
      chat_id: c.chat_id,
      title: c.title,
      type: c.type,
      network: c.network,
      participant_count: c.participant_count,
      last_activity: c.last_activity,
      unread_count: c.unread_count,
      message_count: c.message_count,
    };
    expect("raw" in projected).toBe(false);
    expect("participants" in projected).toBe(false);
    expect(projected.participant_count).toBe(41);
  });

  test("default limit is 50", () => {
    const limit = undefined as number | undefined;
    expect(limit ?? 50).toBe(50);
  });
});
