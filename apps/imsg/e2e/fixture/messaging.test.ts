import { afterEach, beforeEach, expect, test } from "bun:test";
import type { CommandResult, CommaOutboxPayload } from "../../../../convex/schema/comma/validators";
import { createApp } from "../../server/app";
import type { Config } from "../../server/config";
import { OverlayDb } from "../../server/db";
import { registerConvexFixture } from "./convex";
import { FixtureBlueBubbles } from "./fake-bluebubbles";
import { CHAT_GUIDS, FIXTURE_NOW, FixtureIdentity, fixtureSeed } from "./world";

let fixture: Awaited<ReturnType<typeof createApp>>;
beforeEach(async () => {
  const config: Config = { bbUrl: "fixture://bluebubbles", bbPassword: "fixture", hostname: "127.0.0.1", port: 0,
    dbPath: ":memory:", convexSiteUrl: null, convexCloudUrl: null, appleContactsIngestSecret: null,
    identityKey: null, commaBridgeSecret: null, whisper: { binaryPath: null, modelPath: null, workDir: "/tmp/imsg-fixture-test" },
    ai: { gatewayUrl: "http://127.0.0.1:9", gatewayKey: "", fastModel: "fixture", vaultPath: "/tmp" } };
  const bb = new FixtureBlueBubbles(fixtureSeed());
  const db = new OverlayDb(":memory:");
  const names = new FixtureIdentity();
  fixture = await createApp({ config, bb, db, names, identity: names, now: () => FIXTURE_NOW, backgroundServices: false,
    configureFixtureRoutes: (app, controls) => { registerConvexFixture(app, controls, bb, db, names); } });
});
afterEach(() => fixture.dispose());
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fixture.app.request("/__fixture/convex", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, args }) });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
async function command(payload: CommaOutboxPayload, conversationId?: string) {
  const commandId = await call<string>("comma/outbox:enqueue", { clientKey: crypto.randomUUID(), ...(conversationId ? { conversationId } : {}), payload });
  return call<{ status: string; result: CommandResult }>("comma/outbox:getCommand", { commandId });
}

test("fixture creates chats globally and returns a navigable typed result", async () => {
  const receipt = await command({ kind: "createChat", addresses: ["+15550009999"], text: "new chat" });
  expect(receipt).toMatchObject({ status: "sent", result: { kind: "createChat", chatGuid: "iMessage;-;+15550009999", message: { text: "new chat" } } });
  expect(await call("comma/queries:resolveChat", { chatGuid: "iMessage;-;+15550009999" })).toMatchObject({ primaryChatGuid: "iMessage;-;+15550009999" });
});

test("fixture returns contact and FaceTime messages, and guarded reaction results", async () => {
  expect(await command({ kind: "sendContact", name: "Alex", address: "+15550009999", caption: "contact" }, CHAT_GUIDS.needs))
    .toMatchObject({ result: { kind: "sendContact", message: { text: "contact", attachments: [{ filename: "Alex.vcf" }] } } });
  expect(await command({ kind: "createFaceTimeLink" }, CHAT_GUIDS.unreadGroup)).toMatchObject({ result: { kind: "createFaceTimeLink", message: { text: expect.stringContaining("facetime.apple.com") } } });
  expect(await command({ kind: "react", messageGuid: "needs-2", reaction: "like", remove: false, suggested: true }, CHAT_GUIDS.needs)).toMatchObject({ result: { kind: "react", ok: true } });
});

test("fixture group changes return results and deletion stays removed after query refresh", async () => {
  expect(await command({ kind: "participant", address: "+15550009999", action: "add" }, CHAT_GUIDS.unreadGroup)).toMatchObject({ result: { kind: "participant", ok: true } });
  expect(await command({ kind: "leaveGroup" }, CHAT_GUIDS.unreadGroup)).toMatchObject({ result: { kind: "leaveGroup", ok: true } });
  expect(await command({ kind: "deleteChat", chatGuid: CHAT_GUIDS.needs }, CHAT_GUIDS.needs)).toMatchObject({ result: { kind: "deleteChat", ok: true } });
  for (let i = 0; i < 2; i++) expect(await call("comma/queries:resolveChat", { chatGuid: CHAT_GUIDS.needs })).toBeNull();
});
