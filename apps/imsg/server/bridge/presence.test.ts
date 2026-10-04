import { afterEach, expect, spyOn, test } from "bun:test";
import type { BlueBubbles } from "../bluebubbles";
import type { Bodies } from "./convex-ingest";
import type { GenericId } from "convex/values";
import { FakeBlueBubbles } from "../bluebubbles-fake";
import { ChatCommands } from "../commands";
import { ChatDirectory } from "../chat-directory";
import { ContactBook } from "../contacts";
import { OverlayDb } from "../db";
import { typingHandler } from "./commands/presence";
import type { CommandContext } from "./commands/types";
import { FakeIngest } from "./fake-ingest";
import { LiveBridge, MessageWriter } from "./live";
import { OutboundTyping, type PresenceTimers } from "./presence";

const CHAT = "iMessage;-;+15550001111";
const SMS = "SMS;-;+15550001111";
const stops: (() => void)[] = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); });
function fixture() {
  let now = 1000;
  const bb = new FakeBlueBubbles({ chats: [CHAT, SMS].map((guid) => ({ guid, messages: [], participants: [{ address: "+15550001111" }] })) });
  const db = new OverlayDb(":memory:");
  const ingest = new FakeIngest();
  const writer = new MessageWriter({ bb, db, ingest });
  const live = new LiveBridge(writer, () => now);
  stops.push(() => { live.stop(); });
  const presence = () => ingest.calls.flatMap((call) => call.kind === "ephemeral" && call.body.state.kind === "presence" ? [call.body.state] : []);
  return { bb, db, ingest, writer, live, presence, now: () => now, advance: (ms: number) => { now += ms; } };
}
function timers() {
  let fire: (() => void) | undefined;
  let delay = 0;
  const handle = { unref() {} } as ReturnType<typeof setTimeout>;
  const timers: PresenceTimers = { setTimeout: (cb, ms) => { fire = cb; delay = ms; return handle; }, clearTimeout: () => { fire = undefined; } };
  return { timers, fire: () => fire?.(), delay: () => delay };
}

test("incoming on/off uses canonical siblings, expires without replay and clears on reconnect", async () => {
  const h = fixture();
  await h.live.flush();
  h.bb.emit({ kind: "typing", chatGuid: SMS, display: true });
  await h.live.flush();
  expect(h.presence().at(-1)).toEqual({ kind: "presence", conversationId: h.ingest.id, peerTyping: true, updatedAt: 1000, expiresAt: 13_000 });
  h.bb.emit({ kind: "typing", chatGuid: CHAT, display: false });
  await h.live.flush();
  expect(h.presence().at(-1)).toMatchObject({ peerTyping: false, expiresAt: 1000 });
  h.bb.emit({ kind: "typing", chatGuid: SMS, display: true });
  h.advance(12_000);
  await h.live.flush();
  expect(h.presence().at(-1)).toMatchObject({ peerTyping: false });
  h.bb.emit({ kind: "typing", chatGuid: CHAT, display: true });
  await h.live.flush();
  h.bb.emit({ kind: "stream-connected" });
  await h.live.flush();
  expect(h.presence().at(-1)).toMatchObject({ peerTyping: false, expiresAt: 13_000 });
});

test("failed presence publishes retain only the newest sibling transition and never extend expiry", async () => {
  const h = fixture();
  const log = spyOn(console, "error").mockImplementation(() => {});
  stops.push(() => log.mockRestore());
  await h.live.flush();
  h.ingest.fail = "ephemeral";
  h.bb.emit({ kind: "typing", chatGuid: SMS, display: true });
  await h.live.flush();
  expect(h.live.pending).toBeGreaterThan(0);
  h.advance(1);
  h.bb.emit({ kind: "typing", chatGuid: CHAT, display: false });
  h.ingest.fail = null;
  await h.live.flush();
  expect(h.presence().at(-1)).toMatchObject({ peerTyping: false, updatedAt: 1001 });
  expect(h.live.pending).toBe(0);
  h.bb.emit({ kind: "typing", chatGuid: SMS, display: true });
  await h.live.flush();
  h.bb.emit({ kind: "new-message", message: { guid: "incoming", isFromMe: false, chats: [{ guid: CHAT }] } });
  await h.live.flush();
  expect(h.presence().at(-1)).toMatchObject({ peerTyping: false });
});

test("outbound typing discards stale on commands and clears on expiry and reconnect", async () => {
  const h = fixture();
  const t = timers();
  const sent = spyOn(h.bb as BlueBubbles, "setTyping");
  const typing = new OutboundTyping(h.bb, h.now, t.timers);
  stops.push(() => { typing.stop(); sent.mockRestore(); });
  await typing.set(CHAT, true, 1000);
  expect(sent).not.toHaveBeenCalled();
  await typing.set(CHAT, true, 6000);
  expect(t.delay()).toBe(5000);
  h.advance(5000); t.fire(); await typing.flush();
  expect(sent.mock.calls).toEqual([[CHAT, true], [CHAT, false]]);
  await typing.set(CHAT, true, 11_000);
  h.bb.emit({ kind: "stream-connected" }); await typing.flush();
  expect(sent.mock.calls.at(-1)).toEqual([CHAT, false]);
});

test("expiry clear retries after BB downtime and never turns typing back on", async () => {
  const h = fixture();
  const t = timers();
  const sent = spyOn(h.bb as BlueBubbles, "setTyping");
  const log = spyOn(console, "error").mockImplementation(() => {});
  const typing = new OutboundTyping(h.bb, h.now, t.timers);
  stops.push(() => { typing.stop(); sent.mockRestore(); log.mockRestore(); });
  await typing.set(CHAT, true, 2000);
  h.advance(1000); t.fire();
  sent.mockResolvedValueOnce({ ok: false, error: "offline" });
  await typing.flush();
  sent.mockResolvedValue({ ok: true, value: {} });
  h.bb.emit({ kind: "stream-connected" }); await typing.flush();
  expect(sent.mock.calls).toEqual([[CHAT, true], [CHAT, false], [CHAT, false]]);
});

test("typing handler skips superseded transitions and rechecks expiry after the ingest call", async () => {
  const h = fixture();
  const t = timers();
  const sent = spyOn(h.bb as BlueBubbles, "setTyping");
  const typing = new OutboundTyping(h.bb, h.now, t.timers);
  stops.push(() => { typing.stop(); sent.mockRestore(); });
  const contacts = new ContactBook(h.bb);
  const commands = new ChatCommands(h.bb, new ChatDirectory(h.bb, h.db, contacts), contacts);
  const context: CommandContext = { chatGuid: CHAT, writer: h.writer, commands, signal: new AbortController().signal,
    withLeaseRenewal: async (work) => work(), row: {
      _id: "outbox-test" as GenericId<"comma_outbox">, _creationTime: 1000, clientKey: "typing", conversationId: h.ingest.id,
      payload: { kind: "typing", active: true, expiresAt: 6000 }, status: "claimed", attempts: 1, claimToken: "token", leaseUntil: 60_000, createdAt: 1000, updatedAt: 1000,
    } };
  const original = h.ingest.post.bind(h.ingest);
  const post = spyOn(h.ingest, "post");
  stops.push(() => post.mockRestore());
  const handler = typingHandler(typing, h.now);
  post.mockResolvedValueOnce(false);
  await handler.execute(context, { kind: "typing", active: true, expiresAt: 6000 });
  expect(sent).not.toHaveBeenCalled();
  post.mockImplementationOnce(async <K extends keyof Bodies>(kind: K, body: Bodies[K]) => { h.advance(5000); return original(kind, body); });
  await handler.execute(context, { kind: "typing", active: true, expiresAt: 6000 });
  expect(sent).not.toHaveBeenCalled();
  await handler.execute(context, { kind: "typing", active: false, expiresAt: 1000 });
  expect(sent.mock.calls).toEqual([[CHAT, false]]);
});

test("a transport failure on off still retries the clear without waiting for another event", async () => {
  const h = fixture();
  const t = timers();
  const sent = spyOn(h.bb as BlueBubbles, "setTyping");
  const typing = new OutboundTyping(h.bb, h.now, t.timers);
  stops.push(() => { typing.stop(); sent.mockRestore(); });
  await typing.set(CHAT, true, 6000);
  sent.mockRejectedValueOnce(new Error("socket closed"));
  await expect(typing.set(CHAT, false, 1000)).rejects.toThrow("socket closed");
  await typing.flush();
  expect(sent.mock.calls).toEqual([[CHAT, true], [CHAT, false], [CHAT, false]]);
});
