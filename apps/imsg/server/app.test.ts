import { expect, test } from "bun:test";
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
  commaBridgeSecret: null,
  whisper: { binaryPath: null, modelPath: null, workDir: "/tmp/imsg-test-whisper" },
  ai: {
    gatewayUrl: "http://127.0.0.1:9",
    gatewayKey: "",
    fastModel: "fixture",
    vaultPath: "/tmp",
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
    identity: { refresh: async () => {}, start() {}, stop() {}, search: () => [] },
  });
}

test("the retired triage stats API is unavailable", async () => {
  const { app, dispose } = await setup(seed(), () => 100_000);
  try {
    expect((await app.request("/api/triage/stats")).status).toBe(404);
  } finally {
    dispose();
  }
});

test("health reports BlueBubbles and bridge status", async () => {
  const { app, dispose } = await setup(seed(), () => 100_000);
  try {
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, privateApi: true, eventClients: 0, commaBridge: { enabled: false } });
  } finally {
    dispose();
  }
});
