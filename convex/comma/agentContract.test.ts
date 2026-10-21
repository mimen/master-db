import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, onTestFinished, test } from "vitest";

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
  "../../comma/uploads.ts": () => import("./uploads"),
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

test("ask, claim, transcript, draft, a model switch and an image round-trip between the runner and Convex", async () => {
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
  const scratchRoot = mkdtempSync(join(tmpdir(), "comma-contract-"));
  onTestFinished(() => rmSync(scratchRoot, { recursive: true, force: true }));
  let storageFetch = async (_url: string) => new Response(null, { status: 404 });
  const { query, queries } = fakeQueries();
  const sessions = new Sessions({
    port, query, now: () => 5_000, timeZone: "UTC",
    reserve: async () => "session-1",
    readAddendum: () => null,
    options: (input) => ({ model: input.selection.model, systemPrompt: { type: "preset", preset: "claude_code", append: input.append } }),
    scratch: (id) => `${scratchRoot}/${id}`,
    fetch: (url) => storageFetch(url),
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
      { kind: "turn_end", outcome: "completed", durationMs: 0, model: "claude-opus-5-5", effort: "high" },
    ]);
  });
  expect(await milad.query(api.comma.agent.liveChat, { conversationId })).toMatchObject({ sessionId: "session-1", state: "idle", seenThroughMessageAt: 100 });
  expect(await milad.query(api.comma.queries.getDraft, { conversationId })).toMatchObject({ text: "Yes, Friday works!", source: "agent", note: "Confirms Friday" });

  const image = new Uint8Array([137, 80, 78, 71, 13, 10]);
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([image], { type: "image/png" })));
  await milad.mutation(api.comma.uploads.finalizeUpload, { storageId, filename: "menu.png", mimeType: "image/png" });
  const imageUrl = await t.run((ctx) => ctx.storage.getUrl(storageId));
  storageFetch = async (url) => url === imageUrl ? new Response(await t.run(async (ctx) => await (await ctx.storage.get(storageId))!.arrayBuffer())) : new Response(null, { status: 404 });
  await milad.mutation(api.comma.agent.ask, {
    conversationId, key: "ask-2", text: "What does this menu say?", steer: false, model: "gpt-6-luna", effort: "low",
    attachments: [{ storageId, filename: "menu.png", mimeType: "image/png", size: image.byteLength }],
  });
  sessions.receive(await t.query(api.comma.agent.pendingAgentCommands, { bridgeKey: SECRET }));
  await sessions.flush();
  expect(queries).toHaveLength(1);
  expect(queries[0].switches).toEqual([{ model: "gpt-6-luna" }, { effortLevel: "low" }]);
  await eventually(() => expect(queries[0].sent).toHaveLength(2));
  const [imageBlock, textBlock] = queries[0].sent[1].message.content as { type: string; source?: object; text?: string }[];
  expect(imageBlock).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from(image).toString("base64") } });
  expect(textBlock.text).toMatch(/^What does this menu say\?\n\n\[Attached image "menu\.png" is saved at: .+\/attachments\/.+\/menu\.png\]$/);

  queries[0].emit({
    type: "assistant", uuid: "a2-frame", parent_tool_use_id: null, message: { id: "a2", content: [
      { type: "tool_use", id: "todo-1", name: "TodoWrite", input: { todos: [{ content: "Read the menu", activeForm: "Reading the menu", status: "in_progress" }] } },
      { type: "tool_use", id: "op-1", name: "Bash", input: { command: "op read op://Sol/Menu/password", description: "Read the menu password" } },
    ] },
  });
  queries[0].emit({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "op-1", content: "hunter2" }] } });
  queries[0].emit(sdkText("a3", "Tacos, three ways."));
  queries[0].emit(sdkResult("r2", "Tacos, three ways."));
  await settle();
  await eventually(async () => {
    const entries = (await milad.query(api.comma.agent.listItems, { chatId })).slice(4).map(({ entry }) => entry);
    expect(entries).toEqual([
      { kind: "user", text: "What does this menu say?", steer: false, attachments: [{ filename: "menu.png", mimeType: "image/png", size: 6 }] },
      { kind: "todos", todos: [{ content: "Read the menu", activeForm: "Reading the menu", status: "in_progress" }] },
      { kind: "tool", name: "Bash", summary: "Read a credential", status: "done", startedAt: 5_000, endedAt: 5_000 },
      { kind: "assistant", text: "Tacos, three ways.", streaming: false },
      { kind: "turn_end", outcome: "completed", durationMs: 0, model: "gpt-6-luna", effort: "low" },
    ]);
  });
  expect(await milad.query(api.comma.agent.liveChat, { conversationId })).toMatchObject({ model: "gpt-6-luna", effort: "low", state: "idle" });
  await sessions.closeAll();
});
