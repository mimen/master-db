import { describe, expect, test } from "bun:test";

import { formatMessages } from "./context";

describe("formatMessages", () => {
  test("a message's reactions follow it, mine named as me", () => {
    const line = formatMessages([{
      guid: "g1", at: Date.UTC(2026, 10, 6, 18), fromMe: false, sender: "Alex Rivera", text: "Doors at 9?", attachments: [],
      reactions: [{ reaction: "👍", fromMe: true, sender: "Me" }, { reaction: "❓", fromMe: false, sender: "Sam" }],
    }], "UTC");
    expect(line).toEndWith("] Alex Rivera: Doors at 9? [reactions: 👍 from Milad (me), ❓ from Sam]");
  });

  test("a message without reactions carries no reaction note", () => {
    expect(formatMessages([{ guid: "g2", at: 0, fromMe: true, sender: "Me", text: "yes", attachments: [], reactions: [] }], "UTC"))
      .toEndWith("] Milad (me): yes");
  });
});
