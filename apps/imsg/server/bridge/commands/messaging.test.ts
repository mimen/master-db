import { expect, spyOn, test } from "bun:test";
import type { BBMessage } from "../../bb-types";
import { FakeBlueBubbles } from "../../bluebubbles-fake";
import { ChatDirectory } from "../../chat-directory";
import { ChatCommands, UnknownSendError } from "../../commands";
import { ContactBook } from "../../contacts";
import { OverlayDb } from "../../db";
import { FakeIngest } from "../fake-ingest";
import { MessageWriter } from "../live";
import { ReconcileBridge } from "../reconcile";
import { messagingHandlers } from "./messaging";
import type { CommandContext } from "./types";

const CHAT = "iMessage;-;+15550001111";
const GROUP = "iMessage;+;group";
function harness(chatGuid = CHAT, privateApi = true) {
  const raw: BBMessage = { guid: "inbound", originalROWID: 1, text: "hi", isFromMe: false, dateCreated: 100,
    handle: { address: "+15550001111" }, chats: [{ guid: chatGuid }] };
  const bb = new FakeBlueBubbles({ privateApi, chats: [{ guid: chatGuid,
    participants: [{ address: "+15550001111" }], messages: [raw] }] });
  const send = bb.sendText.bind(bb);
  let rowid = 1;
  bb.sendText = async (...args) => {
    const result = await send(...args);
    if (result.ok) result.value.originalROWID = ++rowid;
    return result;
  };
  const db = new OverlayDb(":memory:");
  const names = new ContactBook(bb);
  const commands = new ChatCommands(bb, new ChatDirectory(bb, db, names), names);
  const ingest = new FakeIngest();
  const writer = new MessageWriter({ bb, db, ingest, names });
  const context: CommandContext = { chatGuid, commands, writer, signal: new AbortController().signal,
    row: { clientKey: "key" } as CommandContext["row"], withLeaseRenewal: (work) => work() };
  return { bb, db, commands, ingest, writer, context, raw };
}

test("send passes mentions, reply part and the client key and returns the full message", async () => {
  const h = harness();
  const send = spyOn(h.bb, "sendText");
  const result = await messagingHandlers.send.execute(h.context, { kind: "send", text: "Hi Alex", replyToGuid: "inbound",
    replyToPart: 2, mentions: [{ start: 3, length: 4, address: "+15550001111" }] });
  expect(send.mock.calls[0]?.[2]).toEqual({ guid: "inbound", part: 2 });
  expect(send.mock.calls[0]?.[3]).toBeDefined();
  expect(send.mock.calls[0]?.[4]).toBe("key");
  expect(result).toMatchObject({ kind: "send", message: { text: "Hi Alex", attachments: [], mentions: [{ start: 3, length: 4 }] } });
  await expect(messagingHandlers.send.execute(h.context, { kind: "send", text: " " })).rejects.toThrow("empty message");
});

test("suggested react keeps inbound, membership and part guards", async () => {
  const h = harness();
  const result = await messagingHandlers.react.execute(h.context, { kind: "react", messageGuid: "inbound", reaction: "love", remove: false, suggested: true });
  expect(result).toEqual({ kind: "react", ok: true });
  const sent = await h.commands.send(CHAT, { text: "mine" });
  if (!sent.ok) throw new Error(sent.error);
  const payload = { kind: "react" as const, messageGuid: sent.value.guid, reaction: "like", remove: false, suggested: true };
  await expect(messagingHandlers.react.execute(h.context, payload)).rejects.toThrow("not valid");
  await expect(messagingHandlers.react.execute(h.context, { ...payload, messageGuid: "inbound", partIndex: 1 })).rejects.toThrow("not reactable");
  await expect(messagingHandlers.react.execute({ ...h.context, chatGuid: "iMessage;-;other" }, { ...payload, messageGuid: "inbound" })).rejects.toThrow("not valid");
});

test("sendContact builds the vCard and preserves caption and message result", async () => {
  const h = harness();
  const attachment = spyOn(h.bb, "sendAttachmentWithCaption").mockResolvedValue({ ok: true, value: { ...h.raw, guid: "card", isFromMe: true } });
  const result = await messagingHandlers.sendContact.execute(h.context, { kind: "sendContact", name: "Alex", address: "alex@example.com", caption: "  Hello  " });
  expect(result).toMatchObject({ kind: "sendContact", message: { guid: "card", chatGuid: CHAT } });
  const args = attachment.mock.calls[0] as unknown as [string, string, Uint8Array, string];
  expect(args.slice(0, 2)).toEqual([CHAT, "Alex.vcf"]);
  expect(new TextDecoder().decode(args[2])).toBe("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alex\r\nN:Alex;;;;\r\nEMAIL;TYPE=INTERNET:alex@example.com\r\nEND:VCARD\r\n");
  expect(args[3]).toBe("Hello");
  await messagingHandlers.sendContact.execute(h.context, { kind: "sendContact", name: "A;B", address: "+15550001111" });
  expect(new TextDecoder().decode((attachment.mock.calls[1] as unknown as [string, string, Uint8Array])[2])).toContain("TEL;TYPE=CELL:+15550001111");
  await expect(messagingHandlers.sendContact.execute(h.context, { kind: "sendContact", name: "", address: "x" })).rejects.toThrow("name and address");
});

test("createChat is global, verifies recipients and exact text, and mirrors before returning", async () => {
  const h = harness();
  const context = { ...h.context, chatGuid: null };
  const result = await messagingHandlers.createChat.execute(context, { kind: "createChat", addresses: ["+15550002222"], text: "hello" });
  expect(result).toMatchObject({ kind: "createChat", chatGuid: "iMessage;-;+15550002222", service: "iMessage", isGroup: false, participants: ["+15550002222"], message: { text: "hello" } });
  expect(h.ingest.calls.map((call) => call.kind)).toEqual(["conversations", "messages"]);
  expect(h.ingest.calls.at(-1)?.body).toMatchObject({ messages: [{ guid: result.message.guid, chatGuid: result.chatGuid }] });
  for (const body of [{ addresses: [], text: "hi" }, { addresses: ["+15550001111", "+1 (555) 000-1111"], text: "hi" }, { addresses: ["x"], text: " hi " }]) {
    await expect(messagingHandlers.createChat.execute(context, { kind: "createChat", ...body })).rejects.toThrow();
  }
  await expect(messagingHandlers.createChat.execute(h.context, { kind: "createChat", addresses: ["x"], text: "hi" })).rejects.toThrow("global");
  const original = h.bb.createChat.bind(h.bb);
  spyOn(h.bb, "createChat").mockImplementation(async (addresses, text) => {
    const chat = await original(addresses, text);
    if (!chat.ok) return chat;
    return { ok: true, value: { ...chat.value, lastMessage: { ...chat.value.lastMessage!, text: "wrong" } } };
  });
  await expect(messagingHandlers.createChat.execute(context, { kind: "createChat", addresses: ["new"], text: "exact" })).rejects.toThrow("invalid sent message");
});

test("createChat rejects an incorrect recipient set and reports mirror failure as unknown", async () => {
  const h = harness();
  const context = { ...h.context, chatGuid: null };
  const original = h.bb.createChat.bind(h.bb);
  const create = spyOn(h.bb, "createChat").mockImplementation(async (addresses, text) => {
    const result = await original(addresses, text);
    if (!result.ok) return result;
    return { ok: true, value: { ...result.value, participants: [{ address: "wrong" }] } };
  });
  await expect(messagingHandlers.createChat.execute(context, { kind: "createChat", addresses: ["new"], text: "exact" })).rejects.toThrow("do not match");
  create.mockRestore();
  h.ingest.fail = "messages";
  await expect(messagingHandlers.createChat.execute(context, { kind: "createChat", addresses: ["new"], text: "exact" })).rejects.toBeInstanceOf(UnknownSendError);
});

test("participant and leaveGroup refresh the mirror and respect private API failures", async () => {
  const h = harness(GROUP);
  const add = spyOn(h.bb, "addParticipant");
  const remove = spyOn(h.bb, "removeParticipant");
  expect(await messagingHandlers.participant.execute(h.context, { kind: "participant", address: "person", action: "add" })).toEqual({ kind: "participant", ok: true });
  expect(add).toHaveBeenCalledWith(GROUP, "person");
  expect(await messagingHandlers.participant.execute(h.context, { kind: "participant", address: "person", action: "remove" })).toEqual({ kind: "participant", ok: true });
  expect(remove).toHaveBeenCalledWith(GROUP, "person");
  expect(await messagingHandlers.leaveGroup.execute(h.context)).toEqual({ kind: "leaveGroup", ok: true });
  expect(h.ingest.calls.filter((call) => call.kind === "conversations")).toHaveLength(3);
  const disabled = harness(GROUP, false);
  await expect(messagingHandlers.participant.execute(disabled.context, { kind: "participant", address: "person", action: "add" })).rejects.toThrow("private API disabled");
  await expect(messagingHandlers.leaveGroup.execute(disabled.context)).rejects.toThrow("private API disabled");
});

test("deleteChat removes feedback and the requested alias and does not reappear on reconcile", async () => {
  const h = harness();
  let deleted = false;
  const originalChats = h.bb.queryChats.bind(h.bb);
  const originalMessages = h.bb.queryMessages.bind(h.bb);
  const originalChat = h.bb.getChat.bind(h.bb);
  spyOn(h.bb, "getChat").mockImplementation(async (guid) => deleted && guid === CHAT ? { ok: false, error: "no such chat" } : originalChat(guid));
  spyOn(h.bb, "queryChats").mockImplementation(async (...args) => deleted ? { ok: true, value: [] } : originalChats(...args));
  spyOn(h.bb, "queryMessages").mockImplementation(async (...args) => deleted ? { ok: true, value: [{ ...h.raw, chats: [] }] } : originalMessages(...args));
  spyOn(h.bb, "deleteChat").mockImplementation(async () => { deleted = true; return { ok: true, value: undefined }; });
  const feedback = spyOn(h.db, "deleteSuggestionFeedbackForChat");
  await h.writer.refreshChats();
  const post = h.ingest.post.bind(h.ingest);
  const deletions: string[] = [];
  h.ingest.post = (async (kind: string, body: { chatGuid?: string }) => {
    if (kind === "deleteChat") { deletions.push(body.chatGuid!); return { done: true }; }
    return post(kind as Parameters<typeof post>[0], body as Parameters<typeof post>[1]);
  }) as typeof h.ingest.post;
  expect(await messagingHandlers.deleteChat.execute(h.context, { kind: "deleteChat", chatGuid: CHAT })).toEqual({ kind: "deleteChat", ok: true });
  expect(deletions).toEqual([CHAT]);
  expect(feedback).toHaveBeenCalledWith(CHAT);
  expect(h.writer.conversationIds.has(CHAT)).toBe(false);
  h.ingest.calls.length = 0;
  const bridge = new ReconcileBridge(h.writer, { dbPath: "/nonexistent/overlay", bbUrl: "test", convexSiteUrl: "test" }, { chatDbPath: "/nonexistent/chat.db" });
  try {
    await bridge.flush();
    expect(h.ingest.calls.some((call) => call.kind === "conversations" || call.kind === "messages")).toBe(false);
  } finally { bridge.stop(); }
  await expect(h.writer.postMessages([h.raw])).rejects.toThrow("no such chat");
  expect(h.writer.conversationIds.has(CHAT)).toBe(false);
  await expect(messagingHandlers.deleteChat.execute(h.context, { kind: "deleteChat", chatGuid: "other" })).rejects.toThrow("not in this conversation");
});

test("FaceTime creates and sends the link and returns the message", async () => {
  const h = harness(GROUP);
  expect(await messagingHandlers.createFaceTimeLink.execute(h.context)).toMatchObject({ kind: "createFaceTimeLink", message: { isFromMe: true, text: expect.stringContaining("facetime.apple.com") } });
  const disabled = harness(GROUP, false);
  await expect(messagingHandlers.createFaceTimeLink.execute(disabled.context)).rejects.toThrow("private API disabled");
  spyOn(h.bb, "sendText").mockRejectedValue(new Error("socket closed"));
  await expect(messagingHandlers.createFaceTimeLink.execute(h.context)).rejects.toBeInstanceOf(UnknownSendError);
});
