import { expect, test } from "bun:test";
import type { BBChat, BBMessage } from "../bb-types";
import type { MessageRow } from "./convex-ingest";
import { sourceVersion, toAttachmentRows, toConversationInputs, toMessageRow } from "./mapper";

const id = "test-conversation" as MessageRow["conversationId"];
const dm: BBChat = { guid: "iMessage;-;+15550001111", participants: [{ address: "+15550001111" }] };
function message(fields: Partial<BBMessage> = {}): BBMessage {
  return { guid: "m1", originalROWID: 42, chats: [dm], text: "hello", dateCreated: 1700000000000, ...fields };
}

test("DM siblings merge without merging international numbers", () => {
  const inputs = toConversationInputs([
    dm, { ...dm, guid: "SMS;-;+15550001111" },
    { guid: "iMessage;-;+445550001111", participants: [{ address: "+445550001111" }] },
  ]);
  expect(inputs.map((input) => input.conversationKey)).toEqual(["dm:+15550001111", "dm:+445550001111"]);
  expect(inputs[0].chats.map((chat) => chat.chatGuid)).toEqual([dm.guid, "SMS;-;+15550001111"]);
  expect(inputs[0].isGroup).toBe(false);
});

test("groups merge by identifier and use newest summary and photo", () => {
  const group: BBChat = { guid: "iMessage;+;group1", displayName: " Friends ", participants: [
    { address: "+15550001111" }, { address: "friend@example.com" },
  ], lastMessage: message(), properties: [{ groupPhotoGuid: "photo" }] };
  const [input] = toConversationInputs([group, { ...group, guid: "SMS;+;group1", lastMessage: null }]);
  expect(input).toMatchObject({ conversationKey: "g:group1", displayName: "Friends", isGroup: true,
    hasGroupPhoto: true, lastMessageAt: 1700000000000, participants: [
      { address: "+15550001111", name: null }, { address: "friend@example.com", name: null },
    ], lastMessage: { text: "hello", guid: "m1" } });
  expect(input.chats).toHaveLength(2);
});

test("tied sibling summaries are deterministic", () => {
  const im = { ...dm, displayName: "iMessage", lastMessage: message() };
  const sms = { ...im, guid: "SMS;-;+15550001111", displayName: "SMS" };
  expect(toConversationInputs([sms, im])).toEqual(toConversationInputs([im, sms]));
  expect(toConversationInputs([sms, im])[0].displayName).toBe("iMessage");
});

test("email keys strip service suffix and lowercase", () => {
  expect(toConversationInputs([{ guid: "iMessage;-;A@Example.com", participants: [
    { address: "A@Example.com (iMessage)" },
  ] }])[0].conversationKey).toBe("dm:a@example.com");
});

test("message fields preserve dates, errors, replies, edits and RCS", () => {
  const row = toMessageRow(message({ chats: [{ guid: "RCS;-;+15550001111" }],
    dateEdited: 1700000001000, dateRetracted: 1700000002000, dateRead: 1700000003000,
    dateDelivered: 1700000004000, threadOriginatorGuid: "parent", error: 12,
    handle: { address: "+15550001111" }, expressiveSendStyleId: "confetti", itemType: 1,
  }), id, 42000);
  expect(row).toMatchObject({ conversationId: id, sourceVersion: 42000, service: "SMS", text: "hello",
    dateCreated: 1700000000000, dateEdited: 1700000001000, dateRetracted: 1700000002000,
    dateRead: 1700000003000, dateDelivered: 1700000004000, edited: true, retracted: true,
    error: 12, replyToGuid: "parent", sendEffect: "confetti", isGroupEvent: true,
    sender: { address: "+15550001111", name: null }, reactions: [], isTapback: false });
});

for (const [code, reaction, remove, text, emoji] of [
  [2001, "like", false, "Liked hello", undefined],
  ["-love", "love", true, "Removed heart", undefined],
  ["2006", "emoji", false, "Reacted 🫶🏽 to “hello 😎”", "🫶🏽"],
  ["3006", "emoji", true, "Removed ❤️ from “hello”", "❤️"],
] as const) {
  test(`tapback ${code} is a raw row with an unprefixed target`, () => {
    const row = toMessageRow(message({ text, associatedMessageGuid: "bp:2/parent", associatedMessageType: code }), id, 42000);
    expect(row).toMatchObject({ isTapback: true, text: "", tapbackTargetGuid: "parent", reactions: [],
      tapback: { targetGuid: "parent", reaction, remove } });
    expect(row.tapback?.emoji).toBe(emoji);
  });
}

test("attributed text and mentions decode through mapMessage", () => {
  const raw = message({ text: null, attributedBody: [{ string: " Hi Jane ", runs: [
    { range: [4, 4], attributes: { __kIMMentionConfirmedMention: "+15550001111" } },
  ] }] });
  expect(toMessageRow(raw, id, 42000)).toMatchObject({ text: "Hi Jane",
    mentions: [{ start: 3, length: 4, address: "+15550001111" }] });
  expect(toConversationInputs([{ ...dm, lastMessage: raw }])[0].lastMessage?.text).toBe("Hi Jane");
});

test("raw attachments retain hidden, unavailable and HEIC siblings", () => {
  const raw = message({ attachments: [
    { guid: "a1", transferName: "photo.HEIC", mimeType: "image/heic", uti: "public.heic",
      transferState: 0, width: 100, height: 200, totalBytes: 400, isSticker: true, hideAttachment: true },
    { guid: "a2", transferName: "photo.HEIC.jpeg", transferState: 5 },
  ] });
  expect(toMessageRow(raw, id, 42000).attachmentGuids).toEqual(["a1", "a2"]);
  expect(toAttachmentRows(raw, id, 42000)).toMatchObject([
    { guid: "a1", messageGuid: "m1", conversationId: id, sourceVersion: 42000,
      filename: "photo.HEIC", transferName: "photo.HEIC", mimeType: "image/heic", uti: "public.heic",
      transferState: 0, width: 100, height: 200, totalBytes: 400, isSticker: true,
      hideAttachment: true, isOnDisk: false },
    { guid: "a2", isOnDisk: true, transferState: 5, isSticker: false, hideAttachment: false },
  ]);
});

test("special content reuses mapMessage", () => {
  expect(toMessageRow(message({ balloonBundleId: "com.apple.ApplePay" }), id, 42000).special)
    .toEqual({ kind: "apple-cash" });
  expect(toMessageRow(message({ replyToGuid: "not-a-reply" }), id, 42000).replyToGuid).toBeUndefined();
});

test("sourceVersion uses ROWID and sequence, never dates", () => {
  expect(sourceVersion(message())).toBe(42000);
  expect(sourceVersion(message({ dateEdited: 9999999 }), 2)).toBe(42002);
  expect(() => sourceVersion(message({ originalROWID: undefined }))).toThrow("ROWID");
  expect(() => sourceVersion(message(), 1000)).toThrow("sequence");
});
