import { expect, test } from "bun:test";
import type { GenericId } from "convex/values";
import { ChatCommands, UnknownSendError } from "../../commands";
import { ContactBook } from "../../contacts";
import { FakeBlueBubbles } from "../../bluebubbles-fake";
import { OverlayDb } from "../../db";
import { FakeIngest } from "../fake-ingest";
import { MessageWriter } from "../live";
import { createMediaHandlers } from "./media";
import type { IMessageContext } from "./types";

const CHAT = "iMessage;-;+15550001111";
const payload = { kind: "sendAttachment" as const, storageId: "storage" as GenericId<"_storage">, filename: "memo.m4a", mimeType: "audio/mp4", caption: "Listen", isAudioMessage: false };
async function harness() {
  const bb = new FakeBlueBubbles({ chats: [{ guid: CHAT, messages: [] }] });
  const db = new OverlayDb(":memory:"); const ingest = new FakeIngest();
  const contacts = new ContactBook(bb);
  const commands = new ChatCommands(bb, contacts);
  const writer = new MessageWriter({ bb, db, ingest });
  await writer.refreshChats();
  const row = { _id: "command", _creationTime: 1, clientKey: "send-file", conversationId: ingest.id, payload, status: "claimed", attempts: 1, createdAt: 1, updatedAt: 1 } as IMessageContext["row"];
  const context: IMessageContext = { chatGuid: CHAT, row, commands, writer, signal: new AbortController().signal, withLeaseRenewal: (work) => work() };
  return { bb, db, ingest, writer, context };
}

test("attachment handlers download Convex bytes and preserve caption and voice flags", async () => {
  const h = await harness(); const calls: unknown[] = [];
  h.context.commands.bb.sendAttachmentWithCaption = async (chat, name, bytes, caption) => { calls.push({ chat, name, bytes: [...bytes], caption, audio: false }); return { ok: true, value: { guid: "sent-file", originalROWID: 1, isFromMe: true, dateCreated: 5 } }; };
  h.context.commands.bb.sendAudio = async (chat, name, bytes) => { calls.push({ chat, name, bytes: [...bytes], audio: true }); return { ok: true, value: { guid: "sent-voice", originalROWID: 2, isFromMe: true, dateCreated: 6 } }; };
  const requests: unknown[] = [];
  const fetcher = (async (url: string | Request | URL, init?: RequestInit) => { expect(url).toBe("https://convex.test/storage"); expect(init?.signal).toBe(h.context.signal); return new Response(new Uint8Array([1, 2, 3])); }) as unknown as typeof fetch;
  const handlers = createMediaHandlers({ fetch: fetcher, post: async (_, request) => { requests.push(request); return "https://convex.test/storage"; } });
  expect(handlers.sendAttachment.longRunning).toBe(true);
  expect(await handlers.sendAttachment.execute(h.context, payload)).toMatchObject({ kind: "sendAttachment", message: { guid: "sent-file", chatGuid: CHAT } });
  await handlers.sendAttachment.execute(h.context, { ...payload, isAudioMessage: true });
  expect(calls).toEqual([{ chat: CHAT, name: "memo.m4a", bytes: [1, 2, 3], caption: "Listen", audio: false }, { chat: CHAT, name: "memo.m4a", bytes: [1, 2, 3], audio: true }]);
  expect(h.bb.sentTexts).toEqual([{ chatGuid: CHAT, message: "Listen" }]);
  expect(requests[0]).toEqual({ kind: "upload", commandId: "command", storageId: "storage" });
  expect(h.ingest.calls.filter((a) => a.kind === "messages")).toHaveLength(2);
  
});

test("failed downloads and missing uploads never send; transport failures are unknown", async () => {
  const h = await harness(); let sent = 0;
  h.context.commands.bb.sendAudio = async () => { sent++; throw new Error("connection lost after send"); };
  const handlers = createMediaHandlers({ fetch: (async () => new Response("", { status: 404 })) as unknown as typeof fetch, post: async () => "https://convex.test/file" });
  await expect(handlers.sendAttachment.execute(h.context, { ...payload, isAudioMessage: true })).rejects.toThrow("404");
  const missing = createMediaHandlers({ fetch, post: async () => false });
  await expect(missing.sendAttachment.execute(h.context, payload)).rejects.toThrow("unavailable");
  expect(sent).toBe(0);
  const ambiguous = createMediaHandlers({ fetch: (async () => new Response("audio")) as unknown as typeof fetch, post: async () => "https://convex.test/file" });
  await expect(ambiguous.sendAttachment.execute(h.context, { ...payload, isAudioMessage: true })).rejects.toBeInstanceOf(UnknownSendError);
  expect(sent).toBe(1); 
});
