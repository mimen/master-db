import { describe, expect, test } from "bun:test";
import type { Message } from "@shared/types";
import { formatBubbleTime, formatReceiptTime } from "@/lib/format";
import { formatFileSize, receiptText, sinceYourReply } from "./message-meta";

const AT = new Date(2026, 9, 4, 10, 30).getTime();
const READ_AT = new Date(2026, 9, 4, 10, 42).getTime();

function message(extra: Partial<Message> = {}): Message {
  return {
    guid: "m-1",
    chatGuid: "iMessage;-;+15550001111",
    text: "See you at 6:30",
    dateCreated: AT,
    dateRead: null,
    dateDelivered: null,
    isFromMe: true,
    service: "iMessage",
    sender: null,
    attachments: [],
    reactions: [],
    error: 0,
    replyToGuid: null,
    replyToPreview: null,
    replyToFromMe: null,
    ...extra,
  } as Message;
}

const base = { isLatestOutgoing: true, slowSend: false, showTime: false };

describe("receiptText", () => {
  test("your newest bubble walks Sending, Delivered, Read", () => {
    expect(receiptText({ ...base, message: message({ pending: true }), slowSend: true })).toBe("Sending…");
    expect(receiptText({ ...base, message: message({ dateDelivered: AT }) })).toBe("Delivered");
    expect(receiptText({ ...base, message: message({ dateDelivered: AT, dateRead: READ_AT }) })).toBe(
      `Read ${formatReceiptTime(READ_AT)}`,
    );
  });

  test("a quick pending send stays silent", () => {
    expect(receiptText({ ...base, message: message({ pending: true }) })).toBeNull();
  });

  test("other bubbles show their time only when tapped; the date separators carry it otherwise", () => {
    expect(receiptText({ ...base, isLatestOutgoing: false, message: message({ dateRead: READ_AT }) })).toBeNull();
    expect(receiptText({ ...base, message: message({ isFromMe: false }) })).toBeNull();
    expect(receiptText({ ...base, isLatestOutgoing: false, showTime: true, message: message() })).toBe(formatBubbleTime(AT));
  });

  test("an edit is noted beside the status", () => {
    expect(receiptText({ ...base, message: message({ edited: true, dateDelivered: AT }) })).toBe("Edited · Delivered");
  });
});

test("formatFileSize", () => {
  expect(formatFileSize(512)).toBe("512 bytes");
  expect(formatFileSize(48_200)).toBe("48 KB");
  expect(formatFileSize(3_200_000)).toBe("3.2 MB");
  expect(formatFileSize(1_500_000_000)).toBe("1.5 GB");
});

describe("sinceYourReply", () => {
  const inbound = (guid: string) => message({ guid, isFromMe: false });
  const outbound = (guid: string) => message({ guid });
  const event = (guid: string) => message({ guid, isFromMe: false, isGroupEvent: true, text: "Maya named the conversation" });

  test("counts the inbound run after your last reply", () => {
    expect(sinceYourReply([inbound("a"), outbound("b"), inbound("c"), inbound("d"), inbound("e")])).toEqual({ start: 2, count: 3 });
  });

  test("skips event lines in the count and at the run's start", () => {
    expect(sinceYourReply([outbound("a"), event("b"), inbound("c"), event("d"), inbound("e")])).toEqual({ start: 2, count: 2 });
  });

  test("is empty when you wrote last or never replied", () => {
    expect(sinceYourReply([inbound("a"), outbound("b")])).toEqual({ start: 2, count: 0 });
    expect(sinceYourReply([inbound("a"), inbound("b")])).toEqual({ start: 2, count: 0 });
  });
});
