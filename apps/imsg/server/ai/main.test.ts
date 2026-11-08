import { expect, test } from "bun:test";
import type { ConvexClient } from "convex/browser";
import { FakeIngest } from "../bridge/fake-ingest";
import type { OutboxRow } from "../bridge/outbox";
import { OverlayDb } from "../db";
import { loadAiProcessConfig, startAi, storedAudio, type AiServiceLike } from "./main";

const env = { CONVEX_CLOUD_URL: "https://x.convex.cloud/", CONVEX_SITE_URL: "https://x.convex.site", COMMA_BRIDGE_SECRET: "secret", HOME: "/Users/test" };

test("the AI process needs Convex and the bridge secret, never BlueBubbles", () => {
  const config = loadAiProcessConfig(env, "key");
  expect(config).toMatchObject({ convexCloudUrl: "https://x.convex.cloud", dbPath: "imsg.db",
    ai: { gatewayKey: "key", vaultPath: "/Users/test/Documents/milad-vault" }, whisper: { binaryPath: null } });
  expect(() => loadAiProcessConfig({ ...env, COMMA_BRIDGE_SECRET: "" }, "key")).toThrow("COMMA_BRIDGE_SECRET is unset");
});

test("a memo is read from its stored original, by conversation", async () => {
  const ingest = new FakeIngest();
  const fetched: string[] = [];
  let type = "audio/x-caf";
  const read = storedAudio(ingest, async (url) => { fetched.push(url); return new Response(new Uint8Array([7, 8]), { headers: { "content-type": type } }); });
  const conversationId = ingest.id;
  expect(await read("memo", conversationId)).toEqual({ ok: false, error: "Attachment is not mirrored yet" });
  ingest.attachment = { url: null, name: "memo.m4a", mime: "audio/mp4" };
  expect(await read("memo", conversationId)).toEqual({ ok: false, error: "The original is not in Convex storage yet" });
  ingest.attachment = { url: "https://storage.test/memo", name: "Audio Message.caf", mime: "audio/x-caf" };
  expect(await read("memo", conversationId)).toEqual({ ok: true, bytes: new Uint8Array([7, 8]), filename: "memo.caf" });
  // A CAF memo is stored transcoded, so the stored type, not the original's name, says what afconvert reads.
  type = "audio/mp4";
  expect(await read("memo", conversationId)).toMatchObject({ filename: "memo.m4a" });
  type = "application/octet-stream";
  expect(await read("memo", conversationId)).toMatchObject({ filename: "Audio Message.caf" });
  expect(fetched).toEqual(["https://storage.test/memo", "https://storage.test/memo", "https://storage.test/memo"]);
  expect(ingest.calls.filter((call) => call.kind === "agentAttachment").map((call) => call.body)).toContainEqual({ conversationId, guid: "memo" });
});

test("reports to the ai status row and drains only the ai lane", async () => {
  const ingest = new FakeIngest();
  const lanes: string[] = [];
  const client = {
    onUpdate: (_ref: unknown, args: { lane?: string }) => { if (args.lane) lanes.push(args.lane); return () => {}; },
    close: () => Promise.resolve(),
  } as unknown as ConvexClient;
  const row = (clientKey: string, payload: OutboxRow["payload"]) => ({
    _id: `row-${clientKey}`, _creationTime: 1, clientKey, conversationId: ingest.id, route: { platform: "imessage", chatGuid: "iMessage;-;+1" },
    payload, claimToken: `claim-${clientKey}`, status: "claimed", attempts: 1, leaseUntil: Date.now() + 60_000, createdAt: 1, updatedAt: 1,
  }) as OutboxRow;
  ingest.outboxRows.push(row("send", { kind: "send", text: "hi" }), row("who", { kind: "identify" }));
  const ai: AiServiceLike = {
    available: true,
    replySuggestions: async () => ({ ok: false, error: "unused" }),
    identify: async () => ({ ok: true, value: { name: "Alex", confidence: "high", reasoning: "vault" } }),
    recordSuggestionFeedback: () => ({ ok: true, value: true }),
    recordReactionFeedback: () => {},
    clearSuggestionLearning: () => {},
  };
  const running = startAi({ config: loadAiProcessConfig(env, ""), db: new OverlayDb(":memory:"), ingest, client, ai });
  try {
    await running.flush();
    expect(ingest.calls.find((call) => call.kind === "ephemeral")?.body).toMatchObject({ state: {
      kind: "executorStatus", key: "ai", connected: true,
      capabilities: { executor: "ai", suggestions: true, whisperAvailable: false, whisperDetail: "WHISPER_BINARY_PATH is not configured" },
    } });
    expect(lanes).toEqual(["ai", "aiBackground"]);
    expect(ingest.calls.filter((call) => call.kind === "complete").map((call) => call.body))
      .toEqual([{ clientKey: "who", claimToken: "claim-who", status: "sent", result: { kind: "identify", contact: { name: "Alex", confidence: "high", reasoning: "vault" } } }]);
    expect(ingest.outboxRows.map((left) => left.clientKey)).toEqual(["send"]);
  } finally { running.stop(); }
});
