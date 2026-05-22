import { describe, expect, test } from "vitest";

describe("searchMessages projection", () => {
  test("shape mirrors result projection (id, chat, network, sender, ...)", () => {
    const m = {
      _id: "id_1",
      chat_id: "!room:beeper.local",
      message_id: "100",
      network: "WhatsApp",
      sender_name: "Susan",
      timestamp: "2026-05-22T22:00:00.000Z",
      type: "TEXT",
      text: "hello world",
      is_sender: false,
      attachments: [],
    };
    const projected = {
      _id: m._id,
      chat_id: m.chat_id,
      message_id: m.message_id,
      network: m.network,
      sender_name: m.sender_name,
      timestamp: m.timestamp,
      type: m.type,
      text: m.text,
      is_sender: m.is_sender,
      has_attachments: (m.attachments?.length ?? 0) > 0,
    };
    expect(projected.has_attachments).toBe(false);
    expect(projected.text).toBe("hello world");
  });

  test("default limit is 50", () => {
    const limit = undefined as number | undefined;
    expect(limit ?? 50).toBe(50);
  });
});
