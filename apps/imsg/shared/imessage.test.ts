import { describe, expect, test } from "bun:test";

import { conversationService, dmAddress, imessageChat } from "./imessage";

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
  expect(conversationService({ imessage: { chatGuid: "SMS;-;+15550001111" } })).toBe("SMS");
  expect(conversationService({ imessage: { chatGuid: "any;-;x" } })).toBe("iMessage");
});

test("a one-to-one conversation's handle comes from its participant, then its chat", () => {
  const chat = { isGroup: false, imessage: { chatGuid: "iMessage;-;+15550001111" } };
  expect(dmAddress({ ...chat, participants: [{ address: "a@b.c", name: null }] })).toBe("a@b.c");
  expect(dmAddress({ ...chat, participants: [] })).toBe("+15550001111");
  expect(dmAddress({ ...chat, isGroup: true, participants: [] })).toBeNull();
});
