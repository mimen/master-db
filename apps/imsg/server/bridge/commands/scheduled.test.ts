import { expect, spyOn, test } from "bun:test";
import type { ConvexClient } from "convex/browser";
import { BlueBubblesClient } from "../../bluebubbles";
import { FakeBlueBubbles } from "../../bluebubbles-fake";
import { ChatDirectory } from "../../chat-directory";
import { ChatCommands } from "../../commands";
import { ContactBook } from "../../contacts";
import { OverlayDb } from "../../db";
import { ScheduledSendNow } from "../../scheduled-send-now";
import { FakeIngest } from "../fake-ingest";
import { MessageWriter } from "../live";
import { OutboxBridge, type OutboxRow } from "../outbox";
import { scheduledHandlers } from "./scheduled";
import type { CommandContext } from "./types";

const CHAT = "iMessage;-;+15550001111";
const SIBLING = "SMS;-;+15550001111";
const sendAt = Date.now() + 86_400_000;

async function harness() {
  const bb = new FakeBlueBubbles({ chats: [CHAT, SIBLING].map((guid) => ({ guid,
    participants: [{ address: "+15550001111" }], messages: [{ guid: guid + "-message", originalROWID: 1, text: "hi", dateCreated: 1 }] })), scheduledMessages: [{
    id: 7, type: "send-message", payload: { chatGuid: SIBLING, message: "hello", method: "private-api" },
    scheduledFor: sendAt, schedule: { type: "once" }, status: "error", error: "server restarted", sentAt: null,
  }] });
  const db = new OverlayDb(":memory:");
  const names = new ContactBook(bb);
  const commands = new ChatCommands(bb, new ChatDirectory(bb, db, names), names);
  const ingest = new FakeIngest();
  const writer = new MessageWriter({ bb, db, ingest });
  writer.conversationIds.set(CHAT, ingest.id);
  await commands.directory.ensureSiblings();
  const ctx: CommandContext = { chatGuid: CHAT, commands, writer, row: {} as OutboxRow,
    signal: new AbortController().signal, withLeaseRenewal: (work) => work() };
  return { bb, db, commands, ingest, ctx };
}

test("schedule returns persisted id/state and publishes before completing the receipt", async () => {
  const h = await harness();
  h.ingest.outboxRows.push({ _id: "outbox", _creationTime: 1, clientKey: "schedule", conversationId: h.ingest.id,
    payload: { kind: "schedule", text: " later ", sendAt }, status: "claimed", attempts: 1,
    claimToken: "claim", leaseUntil: Date.now() + 60_000, createdAt: 1, updatedAt: 1 } as OutboxRow);
  const bridge = new OutboxBridge({ config: { convexCloudUrl: "https://convex.test", commaBridgeSecret: "test" }, commands: h.commands, writer: h.ctx.writer, client: { onUpdate: () => () => {}, close: async () => {} } as unknown as ConvexClient });
  try {
    await bridge.flush();
    const snapshot = h.ingest.calls.findIndex((call) => call.kind === "scheduled");
    const completion = h.ingest.calls.findIndex((call) => call.kind === "complete");
    expect(snapshot).toBeGreaterThan(-1);
    expect(completion).toBeGreaterThan(snapshot);
    expect(h.ingest.calls[completion]).toMatchObject({ kind: "complete", body: { status: "sent",
      result: { kind: "schedule", scheduled: { id: 8, text: "later", sendAt, status: "pending", error: null, sentAt: null } } } });
    expect(h.ingest.calls[snapshot]).toMatchObject({ body: { items: [expect.anything(), { bbId: 8,
      chatGuid: CHAT, text: "later", sendAt, status: "pending" }] } });
  } finally { bridge.stop(); }
});

test("edit rereads a sparse PUT and keeps the scheduled row's original sibling chat", async () => {
  const h = await harness();
  const requests: string[] = [];
  const persisted = { id: 7, type: "send-message", payload: { chatGuid: SIBLING, message: "edited", method: "private-api" },
    scheduledFor: sendAt, schedule: { type: "once" }, status: "error", error: "expired", sentAt: null };
  const server = Bun.serve({ port: 0, fetch: async (request) => {
    requests.push(request.method);
    if (request.method === "PUT") {
      expect(await request.json()).toMatchObject({ payload: { chatGuid: SIBLING, message: "edited" } });
      return Response.json({ status: 200, data: { scheduledFor: sendAt } });
    }
    return Response.json({ status: 200, data: persisted });
  } });
  const seam = new BlueBubblesClient(server.url.toString(), "test");
  const update = spyOn(h.bb, "updateScheduledMessage").mockImplementation((...args) => seam.updateScheduledMessage(...args));
  try {
    const result = await scheduledHandlers.editScheduled.execute(h.ctx, { kind: "editScheduled", bbId: 7, text: "edited", sendAt });
    expect(requests).toEqual(["PUT", "GET"]);
    expect(result).toMatchObject({ kind: "editScheduled", scheduled: { id: 7, chatGuid: SIBLING,
      text: "edited", status: "expired", error: "expired", sentAt: null } });
    expect(h.ingest.calls.at(-1)?.kind).toBe("scheduled");
  } finally { update.mockRestore(); server.stop(true); }
});

test("invalid and past times never reach the durable scheduler", async () => {
  const h = await harness();
  for (const time of [NaN, Infinity, Date.now() - 1]) {
    await expect(scheduledHandlers.schedule.execute(h.ctx, { kind: "schedule", text: "hello", sendAt: time })).rejects.toThrow("future sendAt");
    await expect(scheduledHandlers.editScheduled.execute(h.ctx, { kind: "editScheduled", bbId: 7, text: "hello", sendAt: time })).rejects.toThrow("future sendAt");
  }
  expect(h.bb.scheduledCreates).toEqual([]);
  expect(h.bb.scheduledUpdates).toEqual([]);
  expect(h.ingest.calls).toEqual([]);
});

test("cancel resolves the row, rejects a wrong conversation and propagates deletion failure", async () => {
  const h = await harness();
  const remove = spyOn(h.bb, "deleteScheduledMessage").mockResolvedValue({ ok: false, error: "cancel failed" });
  try {
    h.ctx.chatGuid = "other";
    await expect(scheduledHandlers.cancelScheduled.execute(h.ctx, { kind: "cancelScheduled", bbId: 7 })).rejects.toThrow("not in this conversation");
    expect(remove).not.toHaveBeenCalled();
    h.ctx.chatGuid = CHAT;
    await expect(scheduledHandlers.cancelScheduled.execute(h.ctx, { kind: "cancelScheduled", bbId: 7 })).rejects.toThrow("cancel failed");
    expect(h.ingest.calls).toEqual([]);
    remove.mockRestore();
    expect(await scheduledHandlers.cancelScheduled.execute(h.ctx, { kind: "cancelScheduled", bbId: 7 })).toEqual({ kind: "cancelScheduled", ok: true });
    expect(h.ingest.calls.at(-1)).toEqual({ kind: "scheduled", body: { items: [] } });
  } finally { remove.mockRestore(); }
});

test("duplicate Send now shares the existing service's guard and never sends separate text", async () => {
  const h = await harness();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const original = h.bb.updateScheduledMessage.bind(h.bb);
  const update = spyOn(h.bb, "updateScheduledMessage").mockImplementation(async (...args) => {
    entered(); await hold; return original(...args);
  });
  const service = new ScheduledSendNow(h.bb);
  try {
    const first = scheduledHandlers.sendScheduledNow.execute(h.ctx, { kind: "sendScheduledNow", bbId: 7 });
    await Promise.race([started, first]);

    await expect(scheduledHandlers.sendScheduledNow.execute(h.ctx, { kind: "sendScheduledNow", bbId: 7 })).rejects.toThrow("already claimed");
    expect(await service.send(7)).toEqual({ ok: false, error: "scheduled message is already claimed" });
    release();
    expect(await first).toEqual({ kind: "sendScheduledNow", ok: true });
    expect(h.bb.scheduledUpdates).toHaveLength(1);
    expect(h.bb.scheduledUpdates[0]?.chatGuid).toBe(SIBLING);
    expect(h.bb.sentTexts).toEqual([]);
    expect(h.bb.scheduledDeletes).toEqual([]);
    expect(h.ingest.calls.at(-1)?.kind).toBe("scheduled");
  } finally { release(); update.mockRestore(); }
});

test("failed mirror publication cannot produce a successful scheduling receipt", async () => {
  const h = await harness();
  h.ingest.fail = "scheduled";
  await expect(scheduledHandlers.schedule.execute(h.ctx, { kind: "schedule", text: "later", sendAt })).rejects.toThrow("ingest offline");
  expect(h.bb.scheduledCreates).toHaveLength(1);
});
