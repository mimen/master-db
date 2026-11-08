import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";

import { inScope, isAssociated, messageImessage, messageRead, postedAttachment, postedMessage } from "./messageShape";

const conversationId = "c1" as Id<"comma_conversations">;
const account = "a1" as Id<"comma_accounts">;
const core = {
  guid: "g", conversationId, dateCreated: 1, isFromMe: false, text: "hi", edited: false, retracted: false,
  isGroupEvent: false, mentions: [], attachmentGuids: [], sourceVersion: 1,
};
const flat = { ...core, chatGuid: "SMS;-;+1555", service: "SMS" as const, error: 0, isTapback: true, sendEffect: "slam", reactions: [] };

describe("messageShape", () => {
  test("an old bridge's flat message posts in the nested form", () => {
    expect(postedMessage(flat)).toEqual({ ...core, imessage: { chatGuid: "SMS;-;+1555", service: "SMS", error: 0, isAssociatedMessage: true, sendEffect: "slam" } });
  });

  test("a stored row reads the same in either form", () => {
    const nested = { ...core, imessage: { chatGuid: "SMS;-;+1555", service: "SMS" as const, error: 0, isAssociatedMessage: true, sendEffect: "slam" } };
    expect(messageImessage(flat)).toEqual(nested.imessage);
    expect(isAssociated(flat)).toBe(true);
    expect(isAssociated(nested)).toBe(true);
    expect(messageRead(nested)).toMatchObject({ platform: "imessage", chatGuid: "SMS;-;+1555", service: "SMS", isTapback: true, imessage: nested.imessage });
  });

  test("an attachment's chat.db fields move under imessage", () => {
    const attachment = { guid: "a", messageGuid: "g", conversationId, hideAttachment: false, sourceVersion: 1, transferName: "a.png", isSticker: false, isOnDisk: true };
    expect(postedAttachment(attachment).imessage).toEqual({ transferName: "a.png", isSticker: false, isOnDisk: true });
  });

  test("a row with no account belongs to its platform's only account", () => {
    expect(inScope({}, { platform: "imessage", accountId: account })).toBe(true);
    expect(inScope({ accountId: "a2" as Id<"comma_accounts"> }, { platform: "imessage", accountId: account })).toBe(false);
    expect(inScope({ accountId: "a2" as Id<"comma_accounts"> }, { platform: "imessage", accountId: null })).toBe(true);
  });
});
