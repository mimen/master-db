import { describe, expect, spyOn, test } from "bun:test";
import { createApp } from "./app";
import { FakeBlueBubbles } from "./bluebubbles-fake";
import type { Config } from "./config";
import { OverlayDb } from "./db";

const config: Config = {
  bbUrl: "fixture://bluebubbles",
  bbPassword: "fixture-only",
  hostname: "127.0.0.1",
  port: 0,
  dbPath: ":memory:",
  convexSiteUrl: null,
  appleContactsIngestSecret: null,
  convexCloudUrl: null,
  identityKey: null,
  whisper: { binaryPath: null, modelPath: null, workDir: "/tmp/imsg-test-whisper" },
  ai: {
    gatewayUrl: "http://127.0.0.1:9",
    gatewayKey: "",
    fastModel: "fixture",
    vaultPath: "/tmp",
    creatorRef: "imsg-test",
    ccsBin: "fixture-disabled",
    shadowSeat: "fixture-disabled",
    shadowCwd: "/tmp",
  },
};
const primary = "iMessage;-;+15550001111";
const sibling = "SMS;-;+15550001111";

function seed() {
  return new FakeBlueBubbles({
    chats: [primary, sibling].map((guid, index) => ({
      guid,
      participants: [{ address: "+15550001111" }],
      messages: [{ guid: `m${index}`, text: `message ${index}`, dateCreated: 2000 - index * 1000, isFromMe: false }],
    })),
  });
}

async function setup(bb: FakeBlueBubbles, now: () => number) {
  return createApp({
    config,
    bb,
    db: new OverlayDb(":memory:"),
    now,
    backgroundServices: false,
    shadowStatus: { available: false, detail: "fixture" },
    identity: { refresh: async () => {}, start() {}, stop() {}, search: () => [] },
  });
}

async function messages(app: Awaited<ReturnType<typeof createApp>>["app"], query: string) {
  const response = await app.request(`/api/chats/${encodeURIComponent(primary)}/messages${query}`);
  expect(response.status).toBe(200);
  const body = await response.json() as { guid: string; text: string }[];
  expect(body.map(({ guid, text }) => ({ guid, text }))).toEqual([
    { guid: "m1", text: "message 1" },
    { guid: "m0", text: "message 0" },
  ]);
}

describe("thread sibling lookup", () => {
  for (const query of ["", "?around=1500"]) {
    test(`reuses siblings after TTL expiry and invalidation ${query}`, async () => {
      let now = 100_000;
      const bb = seed();
      const { app, dispose } = await setup(bb, () => now);
      try {
        expect(bb.calls.queryChats).toBe(1);
        now += 31_000;
        await messages(app, query);
        bb.emit({ kind: "new-message", message: { guid: "unknown", dateCreated: now } });
        await messages(app, query);
        expect(bb.calls.queryChats).toBe(1);
        expect(bb.calls.queryMessages).toBe(1);
      } finally {
        dispose();
      }
    });

    test(`builds siblings on request when startup failed ${query}`, async () => {
      const bb = seed();
      const queryChats = spyOn(bb, "queryChats");
      queryChats.mockResolvedValueOnce({ ok: false, error: "temporarily unavailable" });
      const { app, dispose } = await setup(bb, () => 100_000);
      try {
        await messages(app, query);
        expect(queryChats).toHaveBeenCalledTimes(2);
      } finally {
        dispose();
        queryChats.mockRestore();
      }
    });
  }

  test("an empty successful build does not trigger repeated rebuilds", async () => {
    let now = 100_000;
    const bb = new FakeBlueBubbles({ chats: [] });
    const { app, dispose } = await setup(bb, () => now);
    try {
      now += 31_000;
      const response = await app.request(`/api/chats/${encodeURIComponent(primary)}/messages`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
      expect(bb.calls.queryChats).toBe(1);
    } finally {
      dispose();
    }
  });
});

describe("open-path instrumentation", () => {
  test("the messages response reports its sibling, page, and build phases", async () => {
    const { app, dispose } = await setup(seed(), () => 100_000);
    try {
      const response = await app.request(`/api/chats/${encodeURIComponent(primary)}/messages`);
      const phases = (response.headers.get("Server-Timing") ?? "")
        .split(",")
        .map((entry) => entry.split(";")[0]);
      expect(phases).toEqual(["siblings", "bb0", "bb1", "build", "total"]);
    } finally {
      dispose();
    }
  });
});

describe("event stream clients", () => {
  async function eventClients(app: Awaited<ReturnType<typeof createApp>>["app"]) {
    const response = await app.request("/api/health");
    return ((await response.json()) as { eventClients: number }).eventClients;
  }

  test("a closed stream leaves the fanout set", async () => {
    const { app, dispose } = await setup(seed(), () => 100_000);
    try {
      const streams = await Promise.all([app.request("/events"), app.request("/events")]);
      const readers = streams.map((response) => response.body!.getReader());
      await Promise.all(readers.map((reader) => reader.read()));
      expect(await eventClients(app)).toBe(2);

      await readers[0]!.cancel();
      await Bun.sleep(10);
      expect(await eventClients(app)).toBe(1);

      await readers[1]!.cancel();
      await Bun.sleep(10);
      expect(await eventClients(app)).toBe(0);
    } finally {
      dispose();
    }
  });
});
