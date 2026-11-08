import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { fromBridgeMessage } from "@shared/imessage";
import { NOT_SENT_AFTER_MS, NOT_SENT_ERROR } from "@shared/pending-send";
import type { BridgeMessage, ChatSummary, ConversationId } from "@shared/types";
import type { CommandReceipt } from "./command-results";
import { pendingSends, resetPendingSendsForTests, SendCancelledError, withPendingSends, type KeptSend, type SendClient, type SendStore } from "./pending-sends";

const ALEX = "conv-alex" as ConversationId;
const alex = { conversationId: ALEX, isGroup: false, route: { platform: "imessage" as const, accountId: null, imessage: { chatGuid: "iMessage;-;+16195550101" } } };

/** The device's storage, shared by every tab, with locks that queue the way navigator.locks does. */
function device() {
  const records = new Map<string, string>();
  const locks = new Map<string, Promise<void>>();
  const later = async () => { for (let i = 0; i < 3; i++) await Promise.resolve(); };
  const store: SendStore = {
    all: async () => [...records.values()].map((raw) => JSON.parse(raw) as KeptSend),
    get: async (clientKey) => { const raw = records.get(clientKey); return raw ? JSON.parse(raw) as KeptSend : null; },
    put: async (send) => { await later(); records.set(send.bubble.clientKey!, JSON.stringify(send)); },
    drop: async (clientKey) => { await later(); records.delete(clientKey); },
    lock: (name, hold) => {
      const run = (locks.get(name) ?? Promise.resolve()).then(hold);
      locks.set(name, run.catch(() => undefined));
      return run;
    },
  };
  return {
    store,
    records,
    /** Another live tab owning `clientKey`'s send; calling the result closes that tab. */
    otherTabHolds(clientKey: string): () => void {
      let close = () => {};
      void store.lock(`comma-send-${clientKey}`, () => new Promise<void>((release) => { close = release; }));
      return () => close();
    },
  };
}

let disk = device();
beforeEach(() => {
  disk = device();
  resetPendingSendsForTests(disk.store);
});
afterEach(() => {
  resetPendingSendsForTests(disk.store);
  jest.useRealTimers();
});

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
/** The tab closes and opens again on the same device: memory and locks go, storage stays. */
const reload = async () => { await flush(); resetPendingSendsForTests(disk.store); };

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

const real = (guid: string, extra: Partial<BridgeMessage> = {}): BridgeMessage => ({
  guid, chatGuid: alex.route.imessage.chatGuid, text: "hi", dateCreated: Date.now(), dateRead: null, dateDelivered: null, isFromMe: true,
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
    conversationId: id as ConversationId, route: { platform: "imessage" as const, accountId: null, imessage: { chatGuid: `iMessage;-;${id}` } }, displayName: id, kind: "dm", isGroup: false, isSpam: false, known: true, hasGroupPhoto: false,
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
    const bubble = fromBridgeMessage({ ...real("temp-k", { dateCreated: 10 }), clientKey: "k", sendState: "queued" as const });
    const chats = [chat("a", 20)];
    expect(withPendingSends(chats, new Map([["a" as ConversationId, [bubble]]]))).toBe(chats);
    const shownByConvex = [{ ...chat("a", 10), lastMessage: { ...chat("a", 10).lastMessage!, guid: "temp-k" } }];
    expect(withPendingSends(shownByConvex, new Map([["a" as ConversationId, [bubble]]]))).toBe(shownByConvex);
    const older = [chat("a", 1)];
    expect(withPendingSends(older, new Map([["a" as ConversationId, [{ ...bubble, guid: "REAL", sendState: undefined }]]]))).toBe(older);
  });
});

describe("a send kept on the device", () => {
  test("is stored from the gesture until Convex has it, and then the device lets it go", async () => {
    const box = outbox(false);
    void pendingSends.send(alex, { text: "hi" }, box.client).catch(() => undefined);
    await flush();
    const key = keyOf();
    expect([...disk.records.keys()]).toEqual([key]);
    box.setOnline(true);
    await flush();
    expect(box.calls).toEqual([`comma/outbox:enqueue:${key}`]);
    expect([...disk.records.keys()]).toEqual([]);
  });

  test("a tab waiting behind this one gets the lock only after the record is gone, so it never sends it too", async () => {
    const box = outbox(false);
    void pendingSends.send(alex, { text: "hi" }, box.client).catch(() => undefined);
    await flush();
    const key = keyOf();
    const found: unknown[] = [];
    void disk.store.lock(`comma-send-${key}`, async () => { found.push(await disk.store.get(key)); });
    box.setOnline(true);
    await flush();
    expect(found).toEqual([null]);
  });

  test("an offline send survives a reload with its key and time, and reconnect sends exactly one copy", async () => {
    const offline = outbox(false);
    void pendingSends.send(alex, { text: "hi" }, offline.client).catch(() => undefined);
    await flush();
    const before = pendingSends.read(ALEX)[0]!;
    await reload();
    expect(pendingSends.read(ALEX)).toEqual([]);

    const box = outbox(false);
    await pendingSends.restore(box.client);
    await flush();
    expect(pendingSends.read(ALEX).map((m) => [m.guid, m.clientKey, m.dateCreated, m.sendState]))
      .toEqual([[before.guid, before.clientKey, before.dateCreated, "queued"]]);
    expect(box.calls).toEqual([]);
    box.setOnline(true);
    await flush();
    expect(box.calls).toEqual([`comma/outbox:enqueue:${before.clientKey}`]);
    box.finish(before.clientKey!, sent("REAL"));
    await flush();
    expect(shown()).toEqual([["REAL", "landed"]]);
    expect(disk.records.size).toBe(0);
  });

  test("a send that reached Convex just before the reload is not queued again: its key finds the same command", async () => {
    const box = outbox(true);
    let enqueued = false;
    const enqueue = box.client.mutation.bind(box.client);
    // The enqueue lands in Convex but the tab closes before its answer arrives.
    box.client.mutation = (async (ref: never, args: never) => { enqueued = true; await enqueue(ref, args); return new Promise(() => {}); }) as never;
    void pendingSends.send(alex, { text: "hi" }, box.client).catch(() => undefined);
    await flush();
    const key = keyOf();
    expect(enqueued).toBe(true);
    expect([...disk.records.keys()]).toEqual([key]);
    await reload();

    box.client.mutation = enqueue as never;
    await pendingSends.restore(box.client);
    await flush();
    expect(box.rows.size).toBe(1);
    box.finish(key, sent("REAL"));
    await flush();
    expect(shown()).toEqual([["REAL", "landed"]]);
  });

  test("cancel after a reload takes it back for good, and it never reaches Convex", async () => {
    void pendingSends.send(alex, { text: "hi" }, outbox(false).client).catch(() => undefined);
    await reload();
    const box = outbox(false);
    await pendingSends.restore(box.client);
    await flush();
    expect(await pendingSends.cancel(ALEX, pendingSends.read(ALEX)[0]!, box.client)).toBe(true);
    await flush();
    expect(shown()).toEqual([]);
    expect(disk.records.size).toBe(0);
    box.setOnline(true);
    await reload();
    await pendingSends.restore(box.client);
    await flush();
    expect(box.calls).toEqual([]);
    expect(shown()).toEqual([]);
  });

  test("restored past its deadline it is Not sent and stays unsent on reconnect, until Retry sends it under its own key", async () => {
    jest.useFakeTimers();
    void pendingSends.send(alex, { text: "hi" }, outbox(false).client).catch(() => undefined);
    await flush();
    const key = keyOf();
    await reload();
    jest.advanceTimersByTime(NOT_SENT_AFTER_MS);
    const box = outbox(true);
    await pendingSends.restore(box.client);
    await flush();
    expect(shown()).toEqual([[`temp-${key}`, "notSent"]]);
    expect(box.calls).toEqual([]);
    await reload();
    await pendingSends.restore(box.client);
    await flush();
    expect(shown()).toEqual([[`temp-${key}`, "notSent"]]);

    const retried = pendingSends.retry(ALEX, pendingSends.read(ALEX)[0]!, box.client);
    await flush();
    expect(box.calls).toEqual([`comma/outbox:enqueue:${key}`]);
    box.finish(key, sent("REAL"));
    expect((await retried).guid).toBe("REAL");
    await flush();
    expect(disk.records.size).toBe(0);
  });

  test("a send another open tab owns stays that tab's; this tab adopts it only once that tab closes without sending it", async () => {
    void pendingSends.send(alex, { text: "mine" }, outbox(false).client).catch(() => undefined);
    void pendingSends.send(alex, { text: "theirs" }, outbox(false).client).catch(() => undefined);
    await flush();
    const [mine, theirs] = pendingSends.read(ALEX).map((m) => m.clientKey!);
    await reload();
    const closeMine = disk.otherTabHolds(mine!);
    const closeTheirs = disk.otherTabHolds(theirs!);

    const box = outbox(true);
    await pendingSends.restore(box.client);
    await flush();
    expect(shown()).toEqual([]);
    disk.records.delete(mine!);
    closeMine();
    closeTheirs();
    await flush();
    expect(pendingSends.read(ALEX).map((m) => m.text)).toEqual(["theirs"]);
    expect(box.calls).toEqual([`comma/outbox:enqueue:${theirs}`]);
  });
});
