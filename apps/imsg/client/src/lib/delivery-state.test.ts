import type { Message } from "@shared/types";
import { describe, expect, test } from "bun:test";

import { deliveryState } from "./delivery-state";

const NOW = 100 * 60_000;
const HOUR_AGO = NOW - 60 * 60_000;

function message(extra: Partial<Message> = {}): Message {
  return {
    guid: "m-1",
    chatGuid: "iMessage;-;+19512335053",
    text: "He said he's spent like 1000 on Henry's hahah",
    dateCreated: HOUR_AGO,
    dateRead: null,
    dateDelivered: null,
    isFromMe: true,
    service: "SMS",
    sender: null,
    attachments: [],
    special: null,
    sendEffect: null,
    reactions: [],
    replyToGuid: null,
    replyToPreview: null,
    replyToFromMe: null,
    isGroupEvent: false,
    error: 4,
    edited: false,
    retracted: false,
    ...extra,
  };
}

describe("delivery state", () => {
  test("this session's failed send is failed", () => {
    expect(deliveryState(message({ error: 0, failed: true }), null, NOW)).toBe("failed");
  });

  test("an old error with no evidence is uncertain", () => {
    expect(deliveryState(message(), null, NOW)).toBe("uncertain");
    expect(deliveryState(message(), HOUR_AGO - 1, NOW)).toBe("uncertain");
  });

  test("a reply after the message clears a stale error", () => {
    expect(deliveryState(message(), HOUR_AGO + 1, NOW)).toBe("ok");
  });

  test("delivered or read receipts clear the error", () => {
    expect(deliveryState(message({ dateDelivered: HOUR_AGO + 1 }), null, NOW)).toBe("ok");
    expect(deliveryState(message({ dateRead: HOUR_AGO + 1 }), null, NOW)).toBe("ok");
  });

  test("an error under five minutes old is not yet a verdict", () => {
    expect(deliveryState(message({ dateCreated: NOW - 4 * 60_000 }), null, NOW)).toBe("ok");
    expect(deliveryState(message({ dateCreated: NOW - 6 * 60_000 }), null, NOW)).toBe("uncertain");
  });

  test("errors on inbound messages and zero errors are ok", () => {
    expect(deliveryState(message({ isFromMe: false }), null, NOW)).toBe("ok");
    expect(deliveryState(message({ error: 0 }), null, NOW)).toBe("ok");
  });
});
