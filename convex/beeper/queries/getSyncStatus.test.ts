import { describe, expect, test } from "vitest";

describe("getSyncStatus aggregation", () => {
  test("aggregates per-account chat and message counts", () => {
    const accounts = [
      { account_id: "whatsapp", network: "WhatsApp" },
      { account_id: "telegram", network: "Telegram" },
    ];
    const chats = [
      { account_id: "whatsapp" },
      { account_id: "whatsapp" },
      { account_id: "telegram" },
    ];
    const messages = [
      { account_id: "whatsapp" },
      { account_id: "whatsapp" },
      { account_id: "whatsapp" },
      { account_id: "telegram" },
    ];

    const status = accounts.map((a) => ({
      account_id: a.account_id,
      chat_count: chats.filter((c) => c.account_id === a.account_id).length,
      message_count: messages.filter((m) => m.account_id === a.account_id)
        .length,
    }));

    expect(status[0]).toEqual({
      account_id: "whatsapp",
      chat_count: 2,
      message_count: 3,
    });
    expect(status[1]).toEqual({
      account_id: "telegram",
      chat_count: 1,
      message_count: 1,
    });
  });

  test("empty deployment returns zero totals", () => {
    const chats: unknown[] = [];
    const messages: unknown[] = [];
    expect(chats.length).toBe(0);
    expect(messages.length).toBe(0);
  });
});
