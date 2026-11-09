import { expect, test } from "bun:test";

import { chatGuidRoute, conversationRoute, dmAddress, fromBridgeMessage, serviceOf } from "./imessage";
import { platformBadge } from "./platform-profile";

test("a chat GUID's badge: RCS draws green as SMS does, and an unknown service sends as iMessage", () => {
  const badge = (chatGuid: string) => platformBadge(chatGuidRoute(chatGuid));
  expect(badge("RCS;-;+16199813959")).toEqual({ label: "SMS", color: "sms" });
  expect(badge("SMS;+;group-1")).toEqual({ label: "SMS", color: "sms" });
  expect(badge("iMessage;+;chat123")).toEqual({ label: "iMessage", color: "accent" });
  expect(badge("any;-;x")).toEqual({ label: "iMessage", color: "accent" });
});

test("a one-to-one conversation's handle comes from its participant, then its chat", () => {
  const chat = { isGroup: false, route: { platform: "imessage" as const, accountId: null, imessage: { chatGuid: "iMessage;-;+15550001111" } } };
  expect(dmAddress({ ...chat, participants: [{ address: "a@b.c", name: null }] })).toBe("a@b.c");
  expect(dmAddress({ ...chat, participants: [] })).toBe("+15550001111");
  expect(dmAddress({ ...chat, isGroup: true, participants: [] })).toBeNull();
});

test("a cached row whose iMessage route lost its chat GUID has no handle instead of crashing", () => {
  const route = { platform: "imessage" as const, accountId: null, imessage: { chatGuid: undefined as unknown as string } };
  expect(dmAddress({ isGroup: false, route, participants: [] })).toBeNull();
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
