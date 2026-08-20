import { describe, expect, test } from "bun:test";
import { FakeBlueBubbles } from "./bluebubbles-fake";
import { ScheduledSendNow } from "./scheduled-send-now";

function fake(): FakeBlueBubbles {
  return new FakeBlueBubbles({
    chats: [{ guid: "iMessage;-;alex", messages: [] }],
    scheduledMessages: [
      {
        id: 7,
        type: "send-message",
        payload: { chatGuid: "iMessage;-;alex", message: "hello", method: "private-api" },
        scheduledFor: Date.now() + 60_000,
        schedule: { type: "once" },
        status: "pending",
        error: null,
        sentAt: null,
      },
    ],
  });
}

describe("ScheduledSendNow", () => {
  test("moves the durable scheduled row to the immediate future", async () => {
    const bb = fake();
    const result = await new ScheduledSendNow(bb, () => 10_000).send(7);
    expect(result.ok).toBe(true);
    expect(bb.scheduledUpdates).toEqual([{ id: 7, chatGuid: "iMessage;-;alex", text: "hello", sendAt: 10_250 }]);
    expect(bb.scheduledDeletes).toEqual([]);
    expect(bb.sentTexts).toEqual([]);
  });

  test("concurrent claims send exactly once", async () => {
    const bb = fake();
    const service = new ScheduledSendNow(bb);
    const [first, second] = await Promise.all([service.send(7), service.send(7)]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(bb.scheduledUpdates).toHaveLength(1);
    expect(bb.scheduledDeletes).toEqual([]);
    expect(bb.sentTexts).toHaveLength(0);
  });
});
