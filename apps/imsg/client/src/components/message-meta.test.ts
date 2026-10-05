import { describe, expect, test } from "bun:test";
import type { Message } from "@shared/types";
import { formatBubbleTime } from "@/lib/format";
import { formatFileSize, receiptText } from "./message-meta";

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

const base = { isLatestOutgoing: true, slowSend: false, groupEnd: true, showTime: false };

describe("receiptText", () => {
  test("your newest bubble walks Sending, Delivered, Read", () => {
    expect(receiptText({ ...base, message: message({ pending: true }), slowSend: true })).toBe("Sending…");
    expect(receiptText({ ...base, message: message({ dateDelivered: AT }) })).toBe("Delivered");
    expect(receiptText({ ...base, message: message({ dateDelivered: AT, dateRead: READ_AT }) })).toBe(
      `Read ${formatBubbleTime(READ_AT)}`,
    );
  });

  test("a quick pending send shows its time, not Sending", () => {
    expect(receiptText({ ...base, message: message({ pending: true }) })).toBe(formatBubbleTime(AT));
  });

  test("other bubbles keep the time on the end of a run or when tapped", () => {
    expect(receiptText({ ...base, isLatestOutgoing: false, message: message({ dateRead: READ_AT }) })).toBe(formatBubbleTime(AT));
    expect(receiptText({ ...base, isLatestOutgoing: false, groupEnd: false, message: message() })).toBeNull();
    expect(receiptText({ ...base, isLatestOutgoing: false, groupEnd: false, showTime: true, message: message() })).toBe(formatBubbleTime(AT));
    expect(receiptText({ ...base, message: message({ isFromMe: false }) })).toBe(formatBubbleTime(AT));
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
