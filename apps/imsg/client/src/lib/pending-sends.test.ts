import { afterEach, describe, expect, jest, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { NOT_SENT_AFTER_MS, NOT_SENT_ERROR } from "@shared/pending-send";
import type { ChatSummary, ConversationId, Message } from "@shared/types";
import type { CommandReceipt } from "./command-results";
import { pendingSends, resetPendingSendsForTests, SendCancelledError, withPendingSends, type SendClient } from "./pending-sends";

const ALEX = "conv-alex" as ConversationId;
const alex = { conversationId: ALEX, isGroup: false, imessage: { chatGuid: "iMessage;-;+16195550101" } };

afterEach(() => {
  resetPendingSendsForTests();
  jest.useRealTimers();
});

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

/** An in-memory outbox with the Convex functions pendingSends calls, and a connection the test flips. */
function outbox(connected = true) {
  const rows = new Map<string, CommandReceipt & { payload: unknown }>();
  const watchers = new Set<() => void>();
  const connection = new Set<() => void>();
  const calls: string[] = [];
  let online = connected;
  const insert = (clientKey: string, payload: unknown) => {
    const row = rows.get(clientKey) ?? { commandId: `cmd-${clientKey}`, clientKey, status: "pending", updatedAt: 0, payload } as never;
    rows.set(clientKey, row);
    return row.commandId;
  };
  const client = {
    mutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(ref as never);
      calls.push(`${name}:${String(args.clientKey)}`);
      if (name === "comma/outbox:enqueue") return insert(String(args.clientKey), args.payload);
      const row = rows.get(String(args.clientKey));
      if (name === "comma/pendingSends:cancelSend") {
        if (row && row.status !== "pending") return false;
        rows.delete(String(args.clientKey));
        for (const watcher of watchers) watcher();
        return true;
      }
      if (name === "comma/pendingSends:retrySend") return insert(String(args.retryKey), row?.payload);
      throw new Error(`unexpected ${name}`);
    },
    watchQuery: (_ref: unknown, { commandId }: { commandId: string }) => ({
      localQueryResult: () => [...rows.values()].find((row) => row.commandId === commandId) ?? null,
      onUpdate: (callback: () => void) => {
        watchers.add(callback);
        return () => watchers.delete(callback);
      },
    }),
    connectionState: () => ({ isWebSocketConnected: online }),
    subscribeToConnectionState: (callback: () => void) => {
      connection.add(callback);
      return () => connection.delete(callback);
    },
  } as unknown as SendClient;
  return {
    client,
    calls,
    rows,
    setOnline(next: boolean) {
      online = next;
      for (const callback of [...connection]) callback();
    },
    finish(clientKey: string, receipt: Partial<CommandReceipt>) {
      const row = rows.get(clientKey);
      if (!row) throw new Error(`no row ${clientKey}`);
      rows.set(clientKey, { ...row, ...receipt });
      for (const watcher of [...watchers]) watcher();
    },
  };
}

const real = (guid: string, extra: Partial<Message> = {}): Message => ({
  guid, chatGuid: alex.imessage.chatGuid, text: "hi", dateCreated: Date.now(), dateRead: null, dateDelivered: null, isFromMe: true,
  service: "iMessage", sender: null, attachments: [], mentions: [], special: null, sendEffect: null, reactions: [], replyToGuid: null,
  replyToPreview: null, replyToFromMe: null, isGroupEvent: false, error: 0, edited: false, retracted: false, ...extra,
});
const sent = (guid: string) => ({ status: "sent" as const, result: { kind: "send" as const, message: real(guid) } });
const shown = () => pendingSends.read(ALEX).map((m) => [m.guid, m.sendState ?? "landed"]);
const keyOf = () => pendingSends.read(ALEX)[0]!.clientKey!;

describe("a send while Convex is reachable", () => {
  test("draws a queued bubble under its pending guid on the same call, then settles into the landed message", async () => {
    const box = outbox();
    const landed = pendingSends.send(alex, { text: "hi" }, box.client);
    const [bubble] = pendingSends.read(ALEX);
    expect(bubble).toMatchObject({ guid: `temp-${bubble!.clientKey}`, sendState: "queued", isFromMe: true, text: "hi" });
    await flush();
    expect(box.calls).toEqual([`comma/outbox:enqueue:${bubble!.clientKey}`]);
    box.finish(bubble!.clientKey!, sent("REAL"));
    expect((await landed).guid).toBe("REAL");
    expect(pendingSends.read(ALEX).map((m) => [m.guid, m.clientKey, m.sendState])).toEqual([["REAL", bubble!.clientKey, undefined]]);
  });

  test("a Not sent receipt leaves a Not sent bubble, and Retry sends it again under a new key in the same bubble", async () => {
    const box = outbox();
    const landed = pendingSends.send(alex, { text: "hi" }, box.client).catch((error: unknown) => error);
    await flush();
    const key = keyOf();
    box.finish(key, { status: "failed", error: NOT_SENT_ERROR });
    expect((await landed as Error).message).toBe(NOT_SENT_ERROR);
    expect(shown()).toEqual([[`temp-${key}`, "notSent"]]);

    const retried = pendingSends.retry(ALEX, pendingSends.read(ALEX)[0]!, box.client);
    await flush();
    const retryKey = keyOf();
    expect(retryKey).not.toBe(key);
    expect(shown()).toEqual([[`temp-${key}`, "queued"]]);
    expect(box.calls.at(-1)).toBe(`comma/pendingSends:retrySend:${key}`);
    box.finish(retryKey, sent("REAL"));
    expect((await retried).guid).toBe("REAL");
    expect(shown()).toEqual([["REAL", "landed"]]);
  });

  test("cancel removes a queued send, and is refused once the platform has it", async () => {
    const box = outbox();
    const first = pendingSends.send(alex, { text: "one" }, box.client).catch((error: unknown) => error);
    await flush();
    expect(await pendingSends.cancel(ALEX, pendingSends.read(ALEX)[0]!, box.client)).toBe(true);
    expect(await first).toBeInstanceOf(SendCancelledError);
    expect(shown()).toEqual([]);

    void pendingSends.send(alex, { text: "two" }, box.client).catch(() => undefined);
    await flush();
    box.finish(keyOf(), { status: "claimed" });
    expect(await pendingSends.cancel(ALEX, pendingSends.read(ALEX)[0]!, box.client)).toBe(false);
    expect(shown()).toEqual([[`temp-${keyOf()}`, "queued"]]);
  });
});

describe("a send while Convex is out of reach", () => {
  test("waits with its bubble showing, then goes out on reconnect, in the order sent", async () => {
    const box = outbox(false);
    const first = pendingSends.send(alex, { text: "one" }, box.client);
    void pendingSends.send(alex, { text: "two" }, box.client);
    await flush();
    expect(box.calls).toEqual([]);
    expect(pendingSends.read(ALEX).map((m) => [m.text, m.sendState])).toEqual([["one", "queued"], ["two", "queued"]]);
    box.setOnline(true);
    await flush();
    const [one, two] = pendingSends.read(ALEX).map((m) => m.clientKey);
    expect(box.calls).toEqual([`comma/outbox:enqueue:${one}`, `comma/outbox:enqueue:${two}`]);
    box.finish(one!, sent("REAL-1"));
    expect((await first).guid).toBe("REAL-1");
  });

  test("cancelled while waiting, it never reaches Convex", async () => {
    const box = outbox(false);
    const landed = pendingSends.send(alex, { text: "hi" }, box.client).catch((error: unknown) => error);
    await flush();
    expect(await pendingSends.cancel(ALEX, pendingSends.read(ALEX)[0]!, box.client)).toBe(true);
    expect(await landed).toBeInstanceOf(SendCancelledError);
    box.setOnline(true);
    await flush();
    expect(box.calls).toEqual([]);
    expect(shown()).toEqual([]);
  });

  test("past the deadline it gives up as Not sent and stays unsent on reconnect, until Retry sends it under its own key", async () => {
    jest.useFakeTimers();
    const box = outbox(false);
    const landed = pendingSends.send(alex, { text: "hi" }, box.client).catch((error: unknown) => error);
    await flush();
    const key = keyOf();
    jest.advanceTimersByTime(NOT_SENT_AFTER_MS);
    expect((await landed as Error).message).toBe(NOT_SENT_ERROR);
    expect(shown()).toEqual([[`temp-${key}`, "notSent"]]);
    box.setOnline(true);
    await flush();
    expect(box.calls).toEqual([]);

    const retried = pendingSends.retry(ALEX, pendingSends.read(ALEX)[0]!, box.client);
    await flush();
    expect(box.calls).toEqual([`comma/outbox:enqueue:${key}`]);
    box.finish(key, sent("REAL"));
    expect((await retried).guid).toBe("REAL");
  });
});

describe("withPendingSends", () => {
  const chat = (id: string, lastAt: number): ChatSummary => ({
    conversationId: id as ConversationId, imessage: { chatGuid: `iMessage;-;${id}` }, displayName: id, isGroup: false, isSpam: false, known: true, hasGroupPhoto: false,
    participants: [], unreadCount: 0, flags: { unresponded: true, waiting: false } as ChatSummary["flags"],
    lastMessage: { guid: `last-${id}`, text: "old", dateCreated: lastAt, isFromMe: false, senderName: null, hasAttachments: false },
  } as ChatSummary);

  test("a send on its way moves its own conversation with Waiting and leaves the rest identical", () => {
    const box = outbox(false);
    void pendingSends.send({ ...alex, conversationId: "b" as ConversationId }, { text: "hi" }, box.client);
    const chats = [chat("a", 1), chat("b", 1)];
    const sends = new Map([["b" as ConversationId, pendingSends.read("b" as ConversationId)]]);
    const [a, b] = withPendingSends(chats, sends);
    expect(a).toBe(chats[0]);
    expect(b?.lastMessage).toMatchObject({ text: "hi", isFromMe: true });
    expect(b?.flags).toMatchObject({ unresponded: false, waiting: true });
  });

  test("a newer message, a send Convex already shows, or a send that landed leaves the directory alone", () => {
    const bubble = { ...real("temp-k", { dateCreated: 10 }), clientKey: "k", sendState: "queued" as const };
    const chats = [chat("a", 20)];
    expect(withPendingSends(chats, new Map([["a" as ConversationId, [bubble]]]))).toBe(chats);
    const shownByConvex = [{ ...chat("a", 10), lastMessage: { ...chat("a", 10).lastMessage!, guid: "temp-k" } }];
    expect(withPendingSends(shownByConvex, new Map([["a" as ConversationId, [bubble]]]))).toBe(shownByConvex);
    const older = [chat("a", 1)];
    expect(withPendingSends(older, new Map([["a" as ConversationId, [{ ...bubble, guid: "REAL", sendState: undefined }]]]))).toBe(older);
  });
});
