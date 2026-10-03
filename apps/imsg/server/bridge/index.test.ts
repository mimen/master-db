import { expect, spyOn, test } from "bun:test";
import { createApp } from "../app";
import { ChatCommands } from "../commands";
import { ChatDirectory } from "../chat-directory";
import { ContactBook } from "../contacts";
import { FakeBlueBubbles } from "../bluebubbles-fake";
import type { Config } from "../config";
import { OverlayDb } from "../db";
import { FakeIngest } from "./fake-ingest";
import { startBridge } from "./index";

const CHAT = "iMessage;-;+15550001111";
const config: Config = {
  bbUrl: "fixture://bb", bbPassword: "fixture", hostname: "127.0.0.1", port: 0, dbPath: ":memory:",
  convexSiteUrl: "http://convex.test", commaBridgeSecret: "test", appleContactsIngestSecret: null,
  convexCloudUrl: null, identityKey: null,
  whisper: { binaryPath: null, modelPath: null, workDir: "/tmp/comma-whisper-test" },
  ai: { gatewayUrl: "http://127.0.0.1:9", gatewayKey: "", fastModel: "fixture", vaultPath: "/tmp" },
};
function fixture() {
  const bb = new FakeBlueBubbles({ chats: [{ guid: CHAT, participants: [{ address: "+15550001111" }],
    messages: [{ guid: "m1", originalROWID: 1, text: "hello", dateCreated: Date.now() }] }] });
  const db = new OverlayDb(":memory:");
  const ingest = new FakeIngest();
  const contacts = new ContactBook(bb);
  const commands = new ChatCommands(bb, new ChatDirectory(bb, db, contacts), contacts);
  return { config, bb, db, ingest, commands, chatDbPath: "/nonexistent/chat.db", avatarDirectory: "/nonexistent/comma-avatar-fixture" };
}

test("bridge is off without a secret or with background services disabled", async () => {
  for (const override of [{ config: { ...config, commaBridgeSecret: null } }, { backgroundServices: false }]) {
    const deps = { ...fixture(), ...override };
    const bridge = startBridge(deps);
    try {
      deps.db.setPinned(CHAT, true);
      deps.bb.emit({ kind: "new-message", message: { guid: "m1" } });
      await bridge.flush();
      expect(bridge.health()).toEqual({ enabled: false, lastEventAt: null, lastReconcileAt: null, cursor: 0, pending: 0, outbox: { inFlight: 0, lastExecutedAt: null }, media: null, photos: { uploaded: 0, pending: 0 } });
      expect(deps.ingest.calls).toEqual([]);
      expect(deps.bb.calls.queryChats).toBe(0);
    } finally { bridge.stop(); }
  }
});

test("startup wires each mirror, reports health, and stops all subscriptions", async () => {
  const deps = fixture();
  deps.db.setPinned(CHAT, true);
  const bridge = startBridge(deps);
  try {
    await bridge.flush();
    expect(bridge.health()).toMatchObject({ enabled: true, cursor: 1, pending: 0 });
    expect(bridge.health().lastReconcileAt).toBeGreaterThan(0);
    const kinds = deps.ingest.calls.map((call) => call.kind);
    for (const kind of ["conversations", "messages", "sync", "overlay", "scheduled"] as const) expect(kinds).toContain(kind);
    deps.bb.emit({ kind: "updated-message", message: { guid: "m1", dateRead: Date.now() } });
    await bridge.flush();
    expect(bridge.health().lastEventAt).toBeGreaterThan(0);
    bridge.stop();
    const before = deps.ingest.calls.length;
    deps.db.setPinned(CHAT, false);
    deps.bb.emit({ kind: "group-changed" });
    bridge.scheduledChanged();
    await bridge.flush();
    expect(deps.ingest.calls).toHaveLength(before);
  } finally { bridge.stop(); }
});

test("bridge failures and misconfiguration cannot throw into startup", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  for (const missingUrl of [false, true]) {
    const deps = fixture();
    deps.ingest.fail = "conversations";
    const bridge = startBridge({ ...deps, config: { ...config, convexSiteUrl: missingUrl ? null : config.convexSiteUrl } });
    try {
      await bridge.flush();
      expect(bridge.health().enabled).toBe(true);
      expect(bridge.health().pending).toBeGreaterThan(0);
      expect(log).toHaveBeenCalled();
    } finally { bridge.stop(); }
  }
  log.mockRestore();
});

test("health and schedule edit/create/cancel routes use the bridge without waiting on Convex", async () => {
  const deps = fixture();
  const identity = { refresh: async () => {}, start() {}, stop() {}, search: () => [] };
  const { app, dispose } = await createApp({ ...deps, identity, bridgeIngest: deps.ingest, bridgeChatDbPath: deps.chatDbPath, bridgeAvatarDirectory: deps.avatarDirectory });
  async function settled() {
    for (let i = 0; i < 100; i++) {
      const health = await (await app.request("/api/health")).json() as { commaBridge: { pending: number; enabled: boolean } };
      expect(health.commaBridge.enabled).toBe(true);
      if (health.commaBridge.pending === 0) return;
      await Bun.sleep(10);
    }
    throw new Error("Bridge did not settle");
  }
  const sendAt = Date.now() + 60_000;
  const headers = { "Content-Type": "application/json" };
  try {
    await settled();
    deps.ingest.calls.length = 0;
    const created = await app.request("/api/scheduled", { method: "POST", headers,
      body: JSON.stringify({ chatGuid: CHAT, text: "scheduled", sendAt }) });
    expect(created.status).toBe(200);
    const row = await created.json() as { id: number };
    await settled();
    expect(deps.ingest.calls.at(-1)?.body).toMatchObject({ items: [{ bbId: row.id, text: "scheduled" }] });
    expect((await app.request(`/api/scheduled/${row.id}`, { method: "PUT", headers,
      body: JSON.stringify({ chatGuid: CHAT, text: "edited", sendAt }) })).status).toBe(200);
    await settled();
    expect(deps.ingest.calls.at(-1)?.body).toMatchObject({ items: [{ text: "edited" }] });
    expect((await app.request(`/api/scheduled/${row.id}/send-now`, { method: "POST" })).status).toBe(200);
    await settled();
    const scheduled = deps.ingest.calls.filter((call) => call.kind === "scheduled").at(-1)!;
    expect(scheduled.body.items[0].sendAt).toBeLessThan(sendAt);
    expect((await app.request(`/api/scheduled/${row.id}`, { method: "DELETE" })).status).toBe(200);
    await settled();
    expect(deps.ingest.calls.at(-1)).toEqual({ kind: "scheduled", body: { items: [] } });
  } finally { dispose(); }
});
