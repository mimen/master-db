import { describe, expect, test } from "bun:test";

import { conversationRoute, conversationService, dmAddress, fromBridgeMessage, imessageChat, serviceOf } from "./imessage";

describe("imessageChat.service", () => {
  test("RCS chats send as SMS, so their optimistic bubbles draw green", () => {
    expect(imessageChat.service("RCS;-;+16199813959")).toBe("SMS");
    expect(imessageChat.service("RCS;+;group-1")).toBe("SMS");
    expect(imessageChat.service("SMS;-;+15550001111")).toBe("SMS");
  });

  test("iMessage chats are iMessage and anything else is unknown", () => {
    expect(imessageChat.service("iMessage;+;chat123")).toBe("iMessage");
    expect(imessageChat.service("any;-;x")).toBeNull();
  });
});

test("a conversation of unknown service sends as iMessage", () => {
  expect(conversationService({ route: { platform: "imessage" as const, accountId: null, imessage: { chatGuid: "SMS;-;+15550001111" } } })).toBe("SMS");
  expect(conversationService({ route: { platform: "imessage" as const, accountId: null, imessage: { chatGuid: "any;-;x" } } })).toBe("iMessage");
});

test("a one-to-one conversation's handle comes from its participant, then its chat", () => {
  const chat = { isGroup: false, route: { platform: "imessage" as const, accountId: null, imessage: { chatGuid: "iMessage;-;+15550001111" } } };
  expect(dmAddress({ ...chat, participants: [{ address: "a@b.c", name: null }] })).toBe("a@b.c");
  expect(dmAddress({ ...chat, participants: [] })).toBe("+15550001111");
  expect(dmAddress({ ...chat, isGroup: true, participants: [] })).toBeNull();
});

test("a conversation's route keeps RCS apart from SMS for its profile", () => {
  expect(conversationRoute({ isGroup: false, route: { platform: "imessage" as const, accountId: null, imessage: { chatGuid: "RCS;-;+16199813959" } } })).toEqual({ platform: "imessage", service: "RCS", isGroup: false });
  expect(conversationRoute({ isGroup: true, route: { platform: "imessage" as const, accountId: null, imessage: { chatGuid: "any;+;x" } } })).toEqual({ platform: "imessage", service: "iMessage", isGroup: true });
});

test("a bridge message keeps its iMessage fields under imessage", () => {
  const message = fromBridgeMessage({
    guid: "g", chatGuid: "SMS;-;+15550001111", text: "hi", dateCreated: 1, dateRead: null, dateDelivered: null, isFromMe: true,
    service: "SMS", sender: null, attachments: [], special: null, sendEffect: null, reactions: [], replyToGuid: null,
    replyToPreview: null, replyToFromMe: null, isGroupEvent: false, error: 0, edited: false, retracted: false,
  });
  expect(message).toMatchObject({ guid: "g", platform: "imessage", imessage: { chatGuid: "SMS;-;+15550001111", service: "SMS", error: 0 } });
  expect("chatGuid" in message).toBe(false);
  expect(serviceOf(message)).toBe("SMS");
});
