import { expect, test } from "bun:test";
import type { GenericId } from "convex/values";
import { ChatCommands, UnknownSendError } from "../../commands";
import { ChatDirectory } from "../../chat-directory";
import { ContactBook } from "../../contacts";
import { FakeBlueBubbles } from "../../bluebubbles-fake";
import { OverlayDb } from "../../db";
import { FakeIngest } from "../fake-ingest";
import { MessageWriter } from "../live";
import { createMediaHandlers, type postMedia } from "./media";
import type { CommandContext } from "./types";
import type { TranscriptState } from "../../../shared/types";

const CHAT = "iMessage;-;+15550001111";
const payload = { kind: "sendAttachment" as const, storageId: "storage" as GenericId<"_storage">, filename: "memo.m4a", mimeType: "audio/mp4", caption: "Listen", isAudioMessage: false };
async function harness() {
  const bb = new FakeBlueBubbles({ chats: [{ guid: CHAT, messages: [] }] });
  const db = new OverlayDb(":memory:"); const ingest = new FakeIngest();
  const contacts = new ContactBook(bb);
  const commands = new ChatCommands(bb, new ChatDirectory(bb, db, contacts), contacts);
  const writer = new MessageWriter({ bb, db, ingest, names: contacts });
  await writer.refreshChats();
  const row = { _id: "command", _creationTime: 1, clientKey: "send-file", conversationId: ingest.id, payload, status: "claimed", attempts: 1, createdAt: 1, updatedAt: 1 } as CommandContext["row"];
  const context: CommandContext = { chatGuid: CHAT, row, commands, writer, signal: new AbortController().signal, withLeaseRenewal: (work) => work() };
  return { bb, db, ingest, writer, context };
}

test("attachment handlers download Convex bytes and preserve caption and voice flags", async () => {
  const h = await harness(); const calls: unknown[] = [];
  h.context.commands.bb.sendAttachmentWithCaption = async (chat, name, bytes, caption) => { calls.push({ chat, name, bytes: [...bytes], caption, audio: false }); return { ok: true, value: { guid: "sent-file", originalROWID: 1, isFromMe: true, dateCreated: 5 } }; };
  h.context.commands.bb.sendAudio = async (chat, name, bytes) => { calls.push({ chat, name, bytes: [...bytes], audio: true }); return { ok: true, value: { guid: "sent-voice", originalROWID: 2, isFromMe: true, dateCreated: 6 } }; };
  const requests: unknown[] = [];
  const fetcher = (async (url: string | Request | URL, init?: RequestInit) => { expect(url).toBe("https://convex.test/storage"); expect(init?.signal).toBe(h.context.signal); return new Response(new Uint8Array([1, 2, 3])); }) as unknown as typeof fetch;
  const handlers = createMediaHandlers({ fetch: fetcher, whisper: () => undefined, post: async (_, request) => { requests.push(request); return "https://convex.test/storage"; } });
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
  const handlers = createMediaHandlers({ fetch: (async () => new Response("", { status: 404 })) as unknown as typeof fetch, whisper: () => undefined, post: async () => "https://convex.test/file" });
  await expect(handlers.sendAttachment.execute(h.context, { ...payload, isAudioMessage: true })).rejects.toThrow("404");
  const missing = createMediaHandlers({ fetch, whisper: () => undefined, post: async () => false });
  await expect(missing.sendAttachment.execute(h.context, payload)).rejects.toThrow("unavailable");
  expect(sent).toBe(0);
  const ambiguous = createMediaHandlers({ fetch: (async () => new Response("audio")) as unknown as typeof fetch, whisper: () => undefined, post: async () => "https://convex.test/file" });
  await expect(ambiguous.sendAttachment.execute(h.context, { ...payload, isAudioMessage: true })).rejects.toBeInstanceOf(UnknownSendError);
  expect(sent).toBe(1); 
});

test("transcribe publishes working before awaiting the terminal result and supports retries", async () => {
  const h = await harness(); const states: TranscriptState[] = [];
  let release: (state: TranscriptState) => void = () => {};
  let job = new Promise<TranscriptState>((resolve) => { release = resolve; });
  const post: typeof postMedia = async (_, request) => { if (request.kind === "transcript") { expect(request.conversationId).toBe(h.ingest.id); states.push(request.transcript); } return true; };
  const handlers = createMediaHandlers({ fetch, post, whisper: () => ({ transcribe: () => job }) });
  const pending = handlers.transcribe.execute(h.context, { kind: "transcribe", attachmentGuid: "memo" });
  await Bun.sleep(0);
  expect(states).toEqual([{ state: "working" }]);
  release({ state: "failed", error: "conversion failed" });
  expect(await pending).toEqual({ kind: "transcribe", transcript: { state: "failed", error: "conversion failed" } });
  job = Promise.resolve({ state: "ready", text: "hello" });
  expect(await handlers.transcribe.execute(h.context, { kind: "transcribe", attachmentGuid: "memo" })).toEqual({ kind: "transcribe", transcript: { state: "ready", text: "hello" } });
  expect(states.map((s) => s.state)).toEqual(["working", "failed", "working", "ready"]);
  expect(handlers.transcribe.longRunning).toBe(true); 
});

test("transcribe publishes unavailable and thrown terminal failures", async () => {
  const h = await harness(); const states: TranscriptState[] = [];
  const post: typeof postMedia = async (_, request) => { if (request.kind === "transcript") states.push(request.transcript); return true; };
  const unavailable = createMediaHandlers({ fetch, post, whisper: () => undefined });
  expect((await unavailable.transcribe.execute(h.context, { kind: "transcribe", attachmentGuid: "memo" })).transcript.state).toBe("unavailable");
  const failed = createMediaHandlers({ fetch, post, whisper: () => ({ transcribe: async () => { throw new Error("lost worker"); } }) });
  await failed.transcribe.execute(h.context, { kind: "transcribe", attachmentGuid: "memo" });
  expect(states.at(-1)).toEqual({ state: "failed", error: "lost worker" }); 
});
