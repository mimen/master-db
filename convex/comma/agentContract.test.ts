import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test } from "vitest";

import { ingestPort } from "../../apps/imsg/server/agent/convex-port";
import { fakeQueries, sdkResult, sdkText, settle } from "../../apps/imsg/server/agent/query-fake";
import { Sessions } from "../../apps/imsg/server/agent/sessions";
import { commaTools } from "../../apps/imsg/server/agent/tools";
import { api } from "../_generated/api";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";

import { commaModules } from "./testModules.vitest";

/**
 * One full agent round with the runner's real Port, Sessions and tools on one side and the real
 * Convex functions on the other, joined over the bridge ingest HTTP routes. Only the Agent SDK
 * and the network hop are fakes, so a shape either side assumes differently fails here.
 */

const modules = {
  ...commaModules,
  "../../comma/agent.ts": () => import("./agent"),
  "../../comma/agentContext.ts": () => import("./agentContext"),
  "../../http.ts": () => import("../http"),
};
const SECRET = "contract-secret";
const SITE = "https://contract.convex.site";
const previous = process.env.COMMA_BRIDGE_SECRET;
const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.COMMA_BRIDGE_SECRET = SECRET;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (previous === undefined) delete process.env.COMMA_BRIDGE_SECRET;
  else process.env.COMMA_BRIDGE_SECRET = previous;
});

/** Retries an assertion while the runner's background writes land; Bun's test runner has no vi.waitFor. */
async function eventually(check: () => unknown) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await check();
    } catch (error) {
      if (attempt === 50) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

test("ask, claim, transcript and draft round-trip between the runner and Convex", async () => {
  const t = convexTest(schema, modules);
  globalThis.fetch = ((url: string, init?: RequestInit) => t.fetch(url.slice(SITE.length), init)) as typeof fetch;
  const conversationId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("comma_conversations", {
      conversationKey: "dm:+15550001111", primaryChatGuid: "iMessage;-;+15550001111", chatGuids: ["iMessage;-;+15550001111"],
      displayName: "Alex", isGroup: false, participants: [{ address: "+15550001111", name: "Alex" }],
      lastMessageAt: 100, isSpam: false, hasGroupPhoto: false, updatedAt: 1,
    });
    await ctx.db.insert("comma_messages", {
      guid: "m1", conversationId: id, chatGuid: "iMessage;-;+15550001111", text: "Are we still on for Friday?", dateCreated: 100,
      isFromMe: false, sender: { address: "+15550001111", name: "Alex" }, service: "iMessage", error: 0, edited: false, retracted: false,
      isTapback: false, reactions: [], isGroupEvent: false, mentions: [], attachmentGuids: [], sourceVersion: 0,
    });
    return id;
  });
  const milad = t.withIdentity({ email: ALLOWED_EMAIL });

  const chatId = await milad.mutation(api.comma.agent.ask, {
    conversationId, key: "ask-1", text: "Draft a yes", steer: false, model: "claude-opus-5-5", effort: "high",
  });

  const port = ingestPort({ convexSiteUrl: SITE, commaBridgeSecret: SECRET });
  const { query, queries } = fakeQueries();
  const sessions = new Sessions({
    port, query, now: () => 5_000, timeZone: "UTC",
    reserve: async () => "session-1",
    readAddendum: () => null,
    options: (input) => ({ model: input.chat.model, systemPrompt: { type: "preset", preset: "claude_code", append: input.append } }),
    log: (message) => { throw new Error(message); },
  });
  sessions.receive(await t.query(api.comma.agent.pendingAgentCommands, { bridgeKey: SECRET }));
  await sessions.flush();
  expect(await t.query(api.comma.agent.pendingAgentCommands, { bridgeKey: SECRET })).toEqual([]);
  expect(queries).toHaveLength(1);
  expect(queries[0].options.systemPrompt).toMatchObject({ append: expect.stringContaining("Alex: Are we still on for Friday?") });
  await eventually(() => expect(queries[0].sent.map((sent) => sent.message.content)).toEqual(["Draft a yes"]));

  queries[0].emit(sdkText("a1", "Here is a yes."));
  await eventually(async () => expect(await milad.query(api.comma.agent.listItems, { chatId })).toHaveLength(2));
  const setDraft = commaTools({ port, chatId, conversationId, scratchDir: "/tmp", timeZone: "UTC", fetch })
    .find((tool) => tool.name === "set_draft")!;
  expect((await setDraft.handler({ text: "Yes, Friday works!", note: "Confirms Friday" } as never, {})).content)
    .toEqual([{ type: "text", text: "The draft is in the composer." }]);
  queries[0].emit(sdkResult("r1", "Here is a yes."));
  await settle();

  await eventually(async () => {
    const items = await milad.query(api.comma.agent.listItems, { chatId });
    expect(items.map(({ entry }) => entry)).toEqual([
      { kind: "user", text: "Draft a yes", steer: false },
      { kind: "assistant", text: "Here is a yes.", streaming: false },
      { kind: "draft", text: "Yes, Friday works!", note: "Confirms Friday", placed: "composer", used: false },
      { kind: "turn_end", outcome: "completed", durationMs: 10 },
    ]);
  });
  expect(await milad.query(api.comma.agent.liveChat, { conversationId })).toMatchObject({ sessionId: "session-1", state: "idle", seenThroughMessageAt: 100 });
  expect(await milad.query(api.comma.queries.getDraft, { conversationId })).toMatchObject({ text: "Yes, Friday works!", source: "agent", note: "Confirms Friday" });
  await sessions.closeAll();
});
