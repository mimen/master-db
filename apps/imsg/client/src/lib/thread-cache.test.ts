import { describe, expect, test } from "bun:test";
import type { Message } from "@shared/types";
import { readThreadCache, writeThreadCache, THREAD_CACHE_KEY } from "./thread-cache";

function message(chatGuid: string, text = "hello"): Message {
  return {
    guid: `${chatGuid}-message`, chatGuid, text, dateCreated: 1000,
    dateRead: null, dateDelivered: null, isFromMe: false, service: "iMessage",
    sender: null, attachments: [], special: null, sendEffect: null, reactions: [],
    replyToGuid: null, replyToPreview: null, replyToFromMe: null,
    isGroupEvent: false, error: 0, edited: false, retracted: false,
  };
}

function storage(limit = Infinity) {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length > limit) throw new DOMException("full", "QuotaExceededError");
      values.set(key, value);
    },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("persistent thread cache", () => {
  test("restores recent threads in LRU order without transient sends", () => {
    const disk = storage();
    const cache = new Map(Array.from({ length: 35 }, (_, i) => [`chat-${i}`, [message(`chat-${i}`)]]));
    cache.set("chat-34", [message("chat-34"), { ...message("chat-34"), guid: "temp", pending: true }]);
    writeThreadCache(disk, cache);
    const restored = readThreadCache(disk);
    expect(restored.size).toBe(30);
    expect([...restored.keys()].slice(0, 2)).toEqual(["chat-5", "chat-6"]);
    expect(restored.get("chat-34")).toEqual([message("chat-34")]);
  });

  test("discards corrupt, mismatched, and malformed cache payloads", () => {
    const disk = storage();
    writeThreadCache(disk, new Map([["chat", [message("chat")]]]));
    expect(readThreadCache(disk).get("chat")).toEqual([message("chat")]);
    const malformed = [
      { attachments: [null] },
      { attachments: [{ guid: "a", mimeType: 42 }] },
      { mentions: [null] },
      { special: { kind: "bogus" } },
      { sender: { address: "alice", name: {} } },
    ].map((fields) => JSON.stringify({ version: 1, threads: [["chat", [{ ...message("chat"), ...fields }]]] }));
    for (const raw of ["{", "null", '{"version":2,"threads":[]}', '{"version":1,"threads":[["chat",[null]]]}', ...malformed]) {
      disk.setItem(THREAD_CACHE_KEY, raw);
      expect(readThreadCache(disk).size).toBe(0);
    }
  });

  test("drops oldest persisted entries on quota failure without changing memory", () => {
    const disk = storage(600);
    const cache = new Map([["old", [message("old")]], ["new", [message("new")]]]);
    writeThreadCache(disk, cache);
    expect([...readThreadCache(disk)]).toEqual([["new", [message("new")]]]);
    expect([...cache.keys()]).toEqual(["old", "new"]);
  });

  test("bounds serialized size and removes a stale snapshot when nothing fits", () => {
    const disk = storage();
    writeThreadCache(disk, new Map([["large", [message("large", "x".repeat(1_100_000))]], ["small", [message("small")]]]));
    expect([...readThreadCache(disk)]).toEqual([["small", [message("small")]]]);
    expect((disk.getItem(THREAD_CACHE_KEY)?.length ?? 0) * 2).toBeLessThan(2 * 1024 * 1024);
    writeThreadCache(disk, new Map([["large", [message("large", "x".repeat(1_100_000))]]]));
    expect(disk.getItem(THREAD_CACHE_KEY)).toBeNull();
  });

  test("unavailable storage does not prevent memory-only operation", () => {
    const disk = {
      getItem: () => { throw new Error("disabled"); },
      setItem: () => { throw new Error("disabled"); },
      removeItem: () => { throw new Error("disabled"); },
    };
    expect(readThreadCache(disk).size).toBe(0);
    const cache = new Map([["chat", [message("chat")]]]);
    writeThreadCache(disk, cache);
    expect(cache.get("chat")).toEqual([message("chat")]);
  });
});
