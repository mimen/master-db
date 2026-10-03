import { describe, expect, test } from "bun:test";

import type { Message } from "@shared/types";

import {
  attachmentSource,
  conversationToChat,
  mergeConvexMessages,
  messageToMessage,
  type ConvexConversation,
  type ConvexMessage,
} from "./convex-adapters";

const flags = { unresponded: true, waiting: false, unread: true, pinned: true, mutedUnresponded: false, archived: false };

function conversation(overrides: Partial<ConvexConversation> = {}): ConvexConversation {
  return {
    _id: "c1",
    _creationTime: 1,
    conversationKey: "dm:+15550001111",
    primaryChatGuid: "iMessage;-;+15550001111",
    chatGuids: ["iMessage;-;+15550001111", "SMS;-;+15550001111"],
    displayName: "Alex",
    isGroup: false,
    participants: [{ address: "+15550001111", name: "Alex" }],
    lastMessage: { guid: "m1", text: "hi", dateCreated: 10, isFromMe: false, senderName: "Alex", hasAttachments: false },
    lastMessageAt: 10,
    isSpam: false,
    hasGroupPhoto: false,
    updatedAt: 10,
    flags,
    unreadCount: 3,
    ...overrides,
  } as ConvexConversation;
}

function message(overrides: Partial<ConvexMessage> = {}): ConvexMessage {
  return {
    _id: "row1",
    _creationTime: 1,
    guid: "m1",
    conversationId: "c1",
    chatGuid: "iMessage;-;+15550001111",
    dateCreated: 10,
    isFromMe: false,
    text: "hi",
    service: "iMessage",
    error: 0,
    edited: false,
    retracted: false,
    isTapback: false,
    reactions: [],
    isGroupEvent: false,
    mentions: [],
    attachmentGuids: [],
    sourceVersion: 1,
    attachments: [],
    ...overrides,
  } as ConvexMessage;
}

const attachment = {
  _id: "a",
  _creationTime: 1,
  messageGuid: "m1",
  conversationId: "c1",
  isSticker: false,
  hideAttachment: false,
  sourceVersion: 1,
  thumbUrl: null,
  originalUrl: null,
};

describe("conversationToChat", () => {
  test("keys REST calls by the primary chat guid and keeps the conversation id", () => {
    const chat = conversationToChat(conversation());
    expect(chat.guid).toBe("iMessage;-;+15550001111");
    expect(chat.conversationId).toBe("c1");
    expect(chat.known).toBe(true);
    expect(chat.flags.pinned).toBe(true);
  });

  test("hides unread until the bridge mirrors it", () => {
    const chat = conversationToChat(conversation());
    expect(chat.unreadCount).toBe(0);
    expect(chat.flags.unread).toBe(false);
  });
});

describe("messageToMessage", () => {
  test("prefers the on-disk JPEG copy over its missing HEIC original", () => {
    const row = message({
      attachments: [
        { ...attachment, guid: "heic", transferName: "IMG.HEIC", mimeType: "image/heic", isOnDisk: false },
        { ...attachment, guid: "jpg", transferName: "IMG.HEIC.jpeg", mimeType: "image/jpeg", isOnDisk: true },
      ],
    } as Partial<ConvexMessage>);
    expect(messageToMessage(row).attachments.map((a) => a.guid)).toEqual(["jpg"]);
  });

  test("drops hidden attachments and maps nullable fields", () => {
    const row = message({
      attachments: [{ ...attachment, guid: "x", hideAttachment: true, isOnDisk: true }],
    } as Partial<ConvexMessage>);
    const mapped = messageToMessage(row);
    expect(mapped.attachments).toEqual([]);
    expect(mapped.dateRead).toBeNull();
    expect(mapped.sender).toBeNull();
  });
});

describe("attachmentSource", () => {
  const summary = { guid: "a", mimeType: "image/jpeg", filename: null, width: null, height: null, totalBytes: null };
  test("uses Convex URLs when present and the REST route otherwise", () => {
    expect(attachmentSource({ ...summary, thumbUrl: "https://t", originalUrl: "https://o" }, "/rest", true)).toBe("https://t");
    expect(attachmentSource({ ...summary, thumbUrl: null, originalUrl: "https://o" }, "/rest", true)).toBe("https://o");
    expect(attachmentSource({ ...summary, thumbUrl: null, originalUrl: null }, "/rest")).toBe("/rest");
  });
});

describe("mergeConvexMessages", () => {
  const remote = (guid: string, at: number, clientKey?: string): Message =>
    ({ ...messageToMessage(message({ guid, dateCreated: at })), clientKey }) as Message;

  test("keeps a pending local send until its echo arrives, then shows it once", () => {
    const pending = { ...remote("temp-1", 20, "temp-1"), pending: true };
    expect(mergeConvexMessages([remote("m1", 10)], [pending]).map((m) => m.guid)).toEqual(["m1", "temp-1"]);
    const echoed = mergeConvexMessages([remote("m1", 10), remote("real-1", 21, "temp-1")], [pending]);
    expect(echoed.map((m) => m.guid)).toEqual(["m1", "real-1"]);
    expect(echoed[1]?.clientKey).toBe("temp-1");
  });
});

describe("queued sends", () => {
  test("an optimistic outbox row reads as pending, and as failed once the bridge reports it", () => {
    const temp = message({ guid: "temp-k1", isFromMe: true, clientKey: "k1", sourceVersion: 0 } as Partial<ConvexMessage>);
    expect(messageToMessage(temp).pending).toBe(true);
    expect(messageToMessage({ ...temp, error: 1 }).failed).toBe(true);
    expect(messageToMessage(message()).pending).toBeUndefined();
  });
});

describe("queued send dedupe", () => {
  test("the Convex temp row and the local bubble for one send render once", () => {
    const local = { ...messageToMessage(message({ guid: "temp-1", isFromMe: true, dateCreated: 20 })), clientKey: "temp-1", pending: true } as Message;
    const convexTemp = messageToMessage(message({ guid: "temp-temp-1", isFromMe: true, clientKey: "temp-1", dateCreated: 20 } as Partial<ConvexMessage>));
    const merged = mergeConvexMessages([convexTemp], [local]);
    expect(merged.map((m) => m.guid)).toEqual(["temp-1"]);
  });
});
