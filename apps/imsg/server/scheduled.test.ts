import { describe, expect, test } from "bun:test";
import { mapScheduledMessage, normalizeScheduledStatus, scheduledMessageRequest } from "./scheduled";

describe("BlueBubbles schedule mapping", () => {
  test("builds the 1.9.9 send-message request", () => {
    expect(scheduledMessageRequest("iMessage;-;alex", "hello", 2_000, "private-api")).toEqual({
      type: "send-message",
      payload: { chatGuid: "iMessage;-;alex", message: "hello", method: "private-api" },
      scheduledFor: 2_000,
      schedule: { type: "once" },
    });
  });

  test("maps status, error, and ISO dates", () => {
    expect(
      mapScheduledMessage(
        {
          id: 7,
          type: "send-message",
          payload: { chatGuid: "g", message: "later", method: "private-api" },
          scheduledFor: "2030-05-06T14:35:00.000Z",
          schedule: { type: "once" },
          status: "error",
          error: "Server was restarted while the scheduled message was in progress.",
          sentAt: null,
        },
        "Alex",
      ),
    ).toEqual({
      id: 7,
      chatGuid: "g",
      chatName: "Alex",
      text: "later",
      sendAt: Date.parse("2030-05-06T14:35:00.000Z"),
      status: "interrupted",
      error: "Server was restarted while the scheduled message was in progress.",
      sentAt: null,
    });
  });

  test("distinguishes failed and expired errors", () => {
    expect(normalizeScheduledStatus("error", "Message expired before it could be sent")).toBe("expired");
    expect(normalizeScheduledStatus("error", "Messages helper disconnected")).toBe("failed");
    expect(normalizeScheduledStatus("pending", null)).toBe("pending");
    expect(normalizeScheduledStatus(undefined, null)).toBe("pending");
  });
});
