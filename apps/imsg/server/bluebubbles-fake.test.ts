import { describe, expect, test } from "bun:test";
import { FakeBlueBubbles } from "./bluebubbles-fake";

describe("FakeBlueBubbles parity behavior", () => {
  test("records attributed-body sends without changing legacy sentTexts", async () => {
    const bb = new FakeBlueBubbles({ chats: [{ guid: "group", messages: [] }] });
    const body = {
      string: "Hi Alex",
      runs: [
        {
          range: [3, 4] as [number, number],
          attributes: {
            __kIMMessagePartAttributeName: 0 as const,
            __kIMMentionConfirmedMention: "+15550001111",
          },
        },
      ],
    };
    await bb.sendText("group", "Hi Alex", undefined, body);
    expect(bb.sentTexts).toEqual([{ chatGuid: "group", message: "Hi Alex" }]);
    expect(bb.sentAttributedBodies).toEqual([{ chatGuid: "group", attributedBody: body }]);
  });

  test("supports schedule create, update, list, and delete", async () => {
    const bb = new FakeBlueBubbles({ chats: [] });
    const created = await bb.createScheduledMessage("group", "first", 10_000);
    expect(created.ok).toBe(true);
    await bb.updateScheduledMessage(1, "group", "edited", 20_000);
    const list = await bb.listScheduledMessages();
    expect(list.ok && list.value[0]?.payload.message).toBe("edited");
    expect(list.ok && list.value[0]?.scheduledFor).toBe(20_000);
    await bb.deleteScheduledMessage(1);
    const empty = await bb.listScheduledMessages();
    expect(empty.ok && empty.value).toEqual([]);
    expect(bb.scheduledCreates).toEqual([{ chatGuid: "group", text: "first", sendAt: 10_000 }]);
    expect(bb.scheduledUpdates).toEqual([{ id: 1, chatGuid: "group", text: "edited", sendAt: 20_000 }]);
    expect(bb.scheduledDeletes).toEqual([1]);
  });
});
