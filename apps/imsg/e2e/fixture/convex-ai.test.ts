import { afterEach, beforeEach, expect, test } from "bun:test";
import type { commandReceipt, suggestionDoc } from "../../../../convex/schema/comma/validators";
import { createApp } from "../../server/app";
import type { Config } from "../../server/config";
import { OverlayDb } from "../../server/db";
import type { SuggestionFeedbackRequest } from "../../shared/types";
import { FixtureAi } from "./ai";
import { registerConvexFixture } from "./convex";
import { FixtureBlueBubbles } from "./fake-bluebubbles";
import { CHAT_GUIDS, FIXTURE_NOW, FixtureIdentity, fixtureSeed } from "./world";

let fixture: Awaited<ReturnType<typeof createApp>>;
let ai: CountingAi;
class CountingAi extends FixtureAi {
  generations = 0;
  feedback = 0;
  clears = 0;
  override replySuggestions(...args: Parameters<FixtureAi["replySuggestions"]>) {
    this.generations++;
    return super.replySuggestions(...args);
  }
  override recordSuggestionFeedback(...args: Parameters<FixtureAi["recordSuggestionFeedback"]>) {
    this.feedback++;
    return super.recordSuggestionFeedback(...args);
  }
  override clearSuggestionLearning() { this.clears++; }
}

beforeEach(async () => {
  const db = new OverlayDb(":memory:");
  const bb = new FixtureBlueBubbles(fixtureSeed());
  const identity = new FixtureIdentity();
  ai = new CountingAi(db);
  const config: Config = {
    bbUrl: "fixture://bluebubbles", bbPassword: "fixture", hostname: "127.0.0.1", port: 0,
    dbPath: ":memory:", convexSiteUrl: null, appleContactsIngestSecret: null,
    convexCloudUrl: null, identityKey: null, commaBridgeSecret: null,
    whisper: { binaryPath: null, modelPath: null, workDir: "/tmp/imsg-fixture-test" },
    ai: { gatewayUrl: "http://127.0.0.1:9", gatewayKey: "", fastModel: "fixture", vaultPath: "/tmp" },
  };
  fixture = await createApp({ config, bb, db, ai, names: identity, identity, now: () => FIXTURE_NOW, backgroundServices: false,
    configureFixtureRoutes: (app, controls) => { registerConvexFixture(app, controls, bb, db, identity); },
  });
});
afterEach(() => fixture.dispose());

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await fixture.app.request("/__fixture/convex", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, args }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
async function command(payload: unknown, clientKey: string, global = false) {
  const commandId = await call<string>("comma/outbox:enqueue", { clientKey, payload, ...(!global ? { conversationId: CHAT_GUIDS.needs } : {}) });
  return call<typeof commandReceipt.type>("comma/outbox:getCommand", { commandId });
}

const cache = (model: "opus" | "terra") => call<typeof suggestionDoc.type | null>("comma/suggestions:getSuggestions", { chatGuid: CHAT_GUIDS.needs, model });

test("fixture supplies model-specific shelves, command receipts, refresh, capabilities, and identity", async () => {
  expect(await call("comma/suggestions:aiStatus")).toMatchObject({ suggestions: true });
  expect(await cache("opus")).toBeNull();
  expect((await command({ kind: "suggestions", model: "opus", refresh: false }, "opus-1")).result).toMatchObject({ kind: "suggestions", suggestions: { selectedModel: "opus", servedModel: "terra", fallback: true, event: null } });
  expect(await cache("opus")).toMatchObject({ model: "opus", anchorGuid: "needs-2" });
  expect(await cache("terra")).toBeNull();
  await command({ kind: "suggestions", model: "terra", refresh: false }, "terra-1");
  await command({ kind: "suggestions", model: "opus", refresh: true }, "opus-2");
  expect(ai.generations).toBe(3);
  expect(await cache("terra")).toMatchObject({ model: "terra" });
  expect((await command({ kind: "identify" }, "identify-1")).result).toMatchObject({ kind: "identify", contact: { confidence: "high", reasoning: "Deterministic fixture identity." } });
});

test("fixture deduplicates feedback and supports a global clear that invalidates cached shelves", async () => {
  await command({ kind: "suggestions", model: "opus", refresh: false }, "opus-1");
  const shelf = await cache("opus");
  const feedback: SuggestionFeedbackRequest = { suggestion: shelf!.payload.suggestions[0] as SuggestionFeedbackRequest["suggestion"],
    selectedModel: "opus", servedModel: "terra", recipeVersion: 3, selectedAt: 1, finalText: "what time do you need the final answer by?" };
  expect((await command({ kind: "suggestionFeedback", feedback }, "feedback-1")).result).toEqual({ kind: "suggestionFeedback", ok: true });
  await command({ kind: "suggestionFeedback", feedback }, "feedback-1");
  expect(ai.feedback).toBe(1);
  expect((await command({ kind: "clearSuggestionLearning" }, "clear-1", true)).result).toEqual({ kind: "clearSuggestionLearning", ok: true });
  await command({ kind: "clearSuggestionLearning" }, "clear-1", true);
  expect(ai.clears).toBe(1);
  expect(await cache("opus")).toBeNull();
});
