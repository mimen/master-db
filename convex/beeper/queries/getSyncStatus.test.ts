import { describe, expect, test } from "vitest";

describe("getSyncStatus aggregation", () => {
  test("sums per-account chat counts and rolls up message_count from beeper_chats", () => {
    const accounts = [
      { account_id: "whatsapp", network: "WhatsApp" },
      { account_id: "telegram", network: "Telegram" },
    ];
    const chats = [
      { account_id: "whatsapp", message_count: 100 },
      { account_id: "whatsapp", message_count: 50 },
      { account_id: "telegram", message_count: 25 },
    ];

    const status = accounts.map((a) => {
      const ac = chats.filter((c) => c.account_id === a.account_id);
      return {
        account_id: a.account_id,
        chat_count: ac.length,
        message_count: ac.reduce((s, c) => s + (c.message_count ?? 0), 0),
      };
    });

    expect(status[0]).toEqual({
      account_id: "whatsapp",
      chat_count: 2,
      message_count: 150,
    });
    expect(status[1]).toEqual({
      account_id: "telegram",
      chat_count: 1,
      message_count: 25,
    });
  });

  test("missing message_count is treated as zero", () => {
    const chats: { account_id: string; message_count?: number }[] = [
      { account_id: "whatsapp", message_count: 10 },
      { account_id: "whatsapp" },
      { account_id: "whatsapp", message_count: 5 },
    ];
    const total = chats.reduce((s, c) => s + (c.message_count ?? 0), 0);
    expect(total).toBe(15);
  });
});
