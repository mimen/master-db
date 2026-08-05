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

  test("returns one exact message with its reactions", async () => {
    const target = {
      guid: "message-1",
      text: "Hello",
      dateCreated: 100,
      isFromMe: true,
    };
    const reaction = {
      guid: "reaction-1",
      associatedMessageGuid: "p:0/message-1",
      associatedMessageType: 2000,
      dateCreated: 101,
      isFromMe: false,
    };
    const bb = new FakeBlueBubbles({
      chats: [{ guid: "chat-1", messages: [target, reaction] }],
    });

    const result = await bb.messageWithReactions("message-1");

    expect(result.ok && result.value.map((message) => message.guid)).toEqual([
      "message-1",
      "reaction-1",
    ]);
    expect(bb.calls.messageWithReactions).toBe(1);
  });

  test("creates a chat with the exact sent message", async () => {
    const bb = new FakeBlueBubbles({ chats: [] });

    const result = await bb.createChat(["+15550001111"], "New thread");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guid).toBe("iMessage;-;+15550001111");
    expect(result.value.lastMessage?.text).toBe("New thread");
    expect(result.value.lastMessage?.isFromMe).toBe(true);
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
