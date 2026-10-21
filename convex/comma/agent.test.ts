import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import type { AgentEntry } from "../schema/comma/validators";

import { commaModules } from "./testModules.vitest";

const modules = {
  ...commaModules,
  "../../comma/agent.ts": () => import("./agent"),
  "../../comma/agentContext.ts": () => import("./agentContext"),
  "../../comma/suggestions.ts": () => import("./suggestions"),
  "../../comma/bridgeState.ts": () => import("./bridgeState"),
  "../../http.ts": () => import("../http"),
};
const SECRET = "agent-secret";
const previous = process.env.COMMA_BRIDGE_SECRET;
beforeEach(() => {
  process.env.COMMA_BRIDGE_SECRET = SECRET;
});
afterEach(() => {
  if (previous === undefined) delete process.env.COMMA_BRIDGE_SECRET;
  else process.env.COMMA_BRIDGE_SECRET = previous;
});

async function setup() {
  const t = convexTest(schema, modules);
  const conversationId = await t.run((ctx) => ctx.db.insert("comma_conversations", {
    conversationKey: "dm:+15550001111", primaryChatGuid: "iMessage;-;+15550001111", chatGuids: ["iMessage;-;+15550001111"],
    displayName: "Alex", isGroup: false, participants: [{ address: "+15550001111", name: "Alex" }],
    lastMessageAt: 1, isSpam: false, hasGroupPhoto: false, updatedAt: 1,
  }));
  const as = t.withIdentity({ email: ALLOWED_EMAIL });
  const ask = (key: string, text = key, steer = false) =>
    as.mutation(api.comma.agent.ask, { conversationId, key, text, steer, model: "claude-opus-5-5", effort: "high" });
  const commands = () => t.run((ctx) => ctx.db.query("comma_agent_commands").collect());
  const items = (chatId: Id<"comma_agent_chats">) => as.query(api.comma.agent.listItems, { chatId });
  return { t, as, conversationId, ask, commands, items };
}

const question = (requestId: string, status: "pending" | "resolved" = "pending"): AgentEntry => ({
  kind: "question", requestId, status, questions: [{ question: "Which?", multiSelect: false, options: [{ label: "A" }, { label: "B" }] }],
});

async function upload(t: Awaited<ReturnType<typeof setup>>["t"], filename: string) {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"], { type: "image/png" })));
  return (await t.mutation(internal.comma.drafts.recordUpload, { storageId, filename, mimeType: "image/png" })).storageId;
}

describe("client functions", () => {
  test("reject callers who are not Milad", async () => {
    const { t, conversationId } = await setup();
    await expect(t.query(api.comma.agent.liveChat, { conversationId })).rejects.toThrow("Unauthorized");
    await expect(t.mutation(api.comma.agent.newChat, { conversationId })).rejects.toThrow("Unauthorized");
  });

  test("ask creates the live chat once and is idempotent on its key", async () => {
    const { as, conversationId, ask, commands, items } = await setup();
    const chatId = await ask("k1", "draft a reply");
    expect(await ask("k1", "draft a reply")).toBe(chatId);
    expect(await as.query(api.comma.agent.liveChat, { conversationId })).toMatchObject({
      _id: chatId, state: "pending", model: "claude-opus-5-5", effort: "high",
    });
    expect((await items(chatId)).map(({ key, ordinal, entry }) => [key, ordinal, entry])).toEqual([
      ["k1", 1, { kind: "user", text: "draft a reply", steer: false }],
    ]);
    expect((await commands()).map(({ command, status }) => [command, status])).toEqual([
      [{ kind: "message", text: "draft a reply", steer: false, model: "claude-opus-5-5", effort: "high" }, "pending"],
    ]);
  });

  test("a later ask carries its own selection, moves the chat's to it, and keeps a busy state", async () => {
    const { t, as, conversationId, ask, commands, items } = await setup();
    const chatId = await ask("k1");
    await t.mutation(internal.comma.agent.agentChat, { chatId, state: "running" });
    await as.mutation(api.comma.agent.ask, { conversationId, key: "k2", text: "faster", steer: true, model: "gpt-6-luna", effort: "low" });
    expect(await t.run((ctx) => ctx.db.get(chatId))).toMatchObject({ state: "running", model: "gpt-6-luna", effort: "low" });
    expect((await commands()).map(({ command }) => command)).toMatchObject([
      { text: "k1", model: "claude-opus-5-5", effort: "high" }, { text: "faster", model: "gpt-6-luna", effort: "low" },
    ]);
    expect((await items(chatId)).map(({ ordinal, entry }) => [ordinal, entry])).toEqual([
      [1, { kind: "user", text: "k1", steer: false }], [2, { kind: "user", text: "faster", steer: true }],
    ]);
    await t.mutation(internal.comma.agent.agentChat, { chatId, state: "idle" });
    await ask("k3");
    expect(await t.run((ctx) => ctx.db.get(chatId))).toMatchObject({ state: "pending" });
  });

  test("ask takes recorded uploads, shows their metadata, and refuses one that was never recorded", async () => {
    const { t, as, conversationId, commands, items } = await setup();
    const storageId = await upload(t, "menu.png");
    const chatId = await as.mutation(api.comma.agent.ask, {
      conversationId, key: "k1", text: "what is this", steer: false, model: "claude-opus-5-5", effort: "high",
      attachments: [{ storageId, filename: "renamed.exe", mimeType: "application/x-msdownload", size: 1 }],
    });
    expect((await items(chatId))[0].entry).toEqual({
      kind: "user", text: "what is this", steer: false, attachments: [{ filename: "menu.png", mimeType: "image/png", size: 5 }],
    });
    expect((await commands())[0].command).toMatchObject({ attachments: [{ storageId, filename: "menu.png", mimeType: "image/png", size: 5 }] });
    const stray = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
    await expect(as.mutation(api.comma.agent.ask, {
      conversationId, key: "k2", text: "and this", steer: false, model: "claude-opus-5-5", effort: "high",
      attachments: [{ storageId: stray, filename: "x", mimeType: "text/plain", size: 1 }],
    })).rejects.toThrow("was not stored");
  });

  test("listItems returns the newest 400 in ascending order", async () => {
    const { t, ask, items } = await setup();
    const chatId = await ask("k0");
    await t.mutation(internal.comma.agent.agentItems, {
      chatId, items: Array.from({ length: 401 }, (_, i) => ({ key: `a${i}`, entry: { kind: "assistant" as const, text: `${i}`, streaming: false } })),
    });
    const listed = await items(chatId);
    expect(listed).toHaveLength(400);
    expect([listed[0].ordinal, listed[399].ordinal]).toEqual([3, 402]);
  });

  test("answer resolves the pending question once and queues one answer command", async () => {
    const { t, as, ask, commands, items } = await setup();
    const chatId = await ask("k1");
    await t.mutation(internal.comma.agent.agentItems, { chatId, items: [{ key: "q", entry: question("r1") }] });
    await as.mutation(api.comma.agent.answer, { chatId, requestId: "r1", answers: { "Which?": "A" } });
    await as.mutation(api.comma.agent.answer, { chatId, requestId: "r1", answers: { "Which?": "B" } });
    expect((await items(chatId)).slice(-1)[0]?.entry).toMatchObject({ kind: "question", status: "resolved", answers: { "Which?": "A" } });
    expect((await commands()).map(({ command }) => command.kind)).toEqual(["message", "answer"]);
  });

  test("stop queues a stop command", async () => {
    const { as, ask, commands } = await setup();
    const chatId = await ask("k1");
    await as.mutation(api.comma.agent.stop, { chatId });
    expect((await commands()).map(({ chatId: id, command }) => [id, command])).toEqual([
      [chatId, { kind: "message", text: "k1", steer: false, model: "claude-opus-5-5", effort: "high" }], [chatId, { kind: "stop" }],
    ]);
  });

  test("newChat archives the live chat and closes its session", async () => {
    const { t, as, conversationId, ask, commands } = await setup();
    const unstarted = await ask("k1");
    await as.mutation(api.comma.agent.newChat, { conversationId });
    expect((await commands()).map(({ command }) => command.kind)).toEqual(["message"]);
    const started = await ask("k2");
    expect(started).not.toBe(unstarted);
    await t.mutation(internal.comma.agent.agentChat, { chatId: started, sessionId: "session-1" });
    await as.mutation(api.comma.agent.newChat, { conversationId });
    expect(await as.query(api.comma.agent.liveChat, { conversationId })).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(started))).toMatchObject({ archivedAt: expect.any(Number) });
    expect((await commands()).map(({ chatId, command }) => [chatId, command.kind])).toEqual([
      [unstarted, "message"], [started, "message"], [started, "close"],
    ]);
  });
});

describe("drafts", () => {
  test("land in an empty composer with their attachments", async () => {
    const { t, as, conversationId, ask, items } = await setup();
    const chatId = await ask("k1");
    const storageId = await upload(t, "a.png");
    const args = { chatId, conversationId, itemKey: "tool-1", text: "On my way", note: "short", attachments: [storageId] };
    expect(await t.mutation(internal.comma.agent.agentDraft, args)).toEqual({ placed: "composer" });
    expect(await as.query(api.comma.queries.getDraft, { conversationId })).toMatchObject({
      text: "On my way", source: "agent", note: "short", attachments: [{ storageId, filename: "a.png" }],
    });
    expect((await items(chatId)).slice(-1)[0]?.entry).toMatchObject({ kind: "draft", placed: "composer", used: false });

    await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "On my way!" });
    expect(await t.mutation(internal.comma.agent.agentDraft, args)).toEqual({ placed: "composer" });
    expect((await items(chatId)).slice(-1)[0]?.entry).toMatchObject({ placed: "composer" });
  });

  test("wait in the pane when the user has typed, and useDraft moves them over with attachments", async () => {
    const { t, as, conversationId, ask, items } = await setup();
    const chatId = await ask("k1");
    await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "my own words" });
    const storageId = await upload(t, "a.png");
    const args = { chatId, conversationId, itemKey: "tool-1", text: "Agent words", attachments: [storageId] };
    expect(await t.mutation(internal.comma.agent.agentDraft, args)).toEqual({ placed: "pane" });
    expect(await t.mutation(internal.comma.agent.agentDraft, args)).toEqual({ placed: "pane" });
    expect(await as.query(api.comma.queries.getDraft, { conversationId })).toMatchObject({ text: "my own words", source: "user" });
    const [item] = (await items(chatId)).filter(({ entry }) => entry.kind === "draft");
    expect(item.entry).toMatchObject({ placed: "pane", used: false, attachments: [{ storageId, filename: "a.png", size: 5 }] });

    await as.mutation(api.comma.agent.useDraft, { itemId: item._id });
    expect(await as.query(api.comma.queries.getDraft, { conversationId })).toMatchObject({
      text: "Agent words", source: "agent", attachments: [{ storageId, filename: "a.png" }],
    });
    expect((await items(chatId)).find(({ _id }) => _id === item._id)?.entry).toMatchObject({ used: true });
  });

  test("useDraft refuses anything but a pane draft", async () => {
    const { t, as, conversationId, ask, items } = await setup();
    const chatId = await ask("k1");
    await t.mutation(internal.comma.agent.agentDraft, { chatId, conversationId, itemKey: "d", text: "hi" });
    for (const item of await items(chatId)) {
      await expect(as.mutation(api.comma.agent.useDraft, { itemId: item._id })).rejects.toThrow("Not a draft");
    }
  });

  test("agentDraft refuses another conversation's chat", async () => {
    const { t, ask } = await setup();
    const chatId = await ask("k1");
    const other = await t.run((ctx) => ctx.db.insert("comma_conversations", {
      conversationKey: "dm:other", primaryChatGuid: "x", chatGuids: ["x"], displayName: "Other", isGroup: false, participants: [],
      lastMessageAt: 1, isSpam: false, hasGroupPhoto: false, updatedAt: 1,
    }));
    await expect(t.mutation(internal.comma.agent.agentDraft, { chatId, conversationId: other, itemKey: "d", text: "hi" }))
      .rejects.toThrow("another conversation");
  });
});

describe("runner functions", () => {
  test("pendingAgentCommands rejects a wrong bridge key and joins each command with its chat", async () => {
    const { t, ask } = await setup();
    await expect(t.query(api.comma.agent.pendingAgentCommands, { bridgeKey: "wrong" })).rejects.toThrow("Unauthorized");
    delete process.env.COMMA_BRIDGE_SECRET;
    await expect(t.query(api.comma.agent.pendingAgentCommands, { bridgeKey: "" })).rejects.toThrow("Unauthorized");
    process.env.COMMA_BRIDGE_SECRET = SECRET;
    const chatId = await ask("k1");
    await ask("k2");
    const pending = await t.query(api.comma.agent.pendingAgentCommands, { bridgeKey: SECRET });
    expect(pending.map(({ command }) => command)).toEqual([
      { kind: "message", text: "k1", steer: false, model: "claude-opus-5-5", effort: "high" },
      { kind: "message", text: "k2", steer: false, model: "claude-opus-5-5", effort: "high" },
    ]);
    expect(pending[0]).toMatchObject({ chatId, chat: { model: "claude-opus-5-5", effort: "high", state: "pending" } });
  });

  test("pendingAgentCommands and agentClaim give each attachment a download URL, and null once it is gone", async () => {
    const { t, as, conversationId } = await setup();
    const kept = await upload(t, "kept.png");
    const gone = await upload(t, "gone.png");
    await as.mutation(api.comma.agent.ask, {
      conversationId, key: "k1", text: "look", steer: false, model: "claude-opus-5-5", effort: "high",
      attachments: [kept, gone].map((storageId) => ({ storageId, filename: "", mimeType: "", size: 0 })),
    });
    await t.run((ctx) => ctx.storage.delete(gone));
    const [pending] = await t.query(api.comma.agent.pendingAgentCommands, { bridgeKey: SECRET });
    expect(pending.command).toEqual({
      kind: "message", text: "look", steer: false, model: "claude-opus-5-5", effort: "high", attachments: [
        { url: await t.run((ctx) => ctx.storage.getUrl(kept)), filename: "kept.png", mimeType: "image/png", size: 5 },
        { url: null, filename: "gone.png", mimeType: "image/png", size: 5 },
      ],
    });
    expect(await t.mutation(internal.comma.agent.agentClaim, { ids: [pending._id] })).toEqual([pending]);
  });

  test("a command row written before per-message selection still reaches the runner as it was", async () => {
    const { t, ask } = await setup();
    const chatId = await ask("k1");
    await t.run((ctx) => ctx.db.insert("comma_agent_commands", {
      chatId, command: { kind: "message", text: "old", steer: false }, status: "pending", createdAt: Date.now() + 1,
    }));
    const pending = await t.query(api.comma.agent.pendingAgentCommands, { bridgeKey: SECRET });
    expect(pending[1].command).toEqual({ kind: "message", text: "old", steer: false });
  });

  test("agentClaim takes pending rows once and never returns a taken row", async () => {
    const { t, ask } = await setup();
    await ask("k1");
    await ask("k2");
    const [first, second] = await t.query(api.comma.agent.pendingAgentCommands, { bridgeKey: SECRET });
    const claimed = await t.mutation(internal.comma.agent.agentClaim, { ids: [first._id] });
    expect(claimed).toEqual([first]);
    expect(await t.mutation(internal.comma.agent.agentClaim, { ids: [first._id, second._id] })).toEqual([second]);
    expect(await t.mutation(internal.comma.agent.agentClaim, { ids: [first._id, second._id] })).toEqual([]);
    expect(await t.query(api.comma.agent.pendingAgentCommands, { bridgeKey: SECRET })).toEqual([]);
  });

  test("agentItems patches existing keys in place and orders new keys after the last", async () => {
    const { t, ask, items } = await setup();
    const chatId = await ask("u");
    await t.mutation(internal.comma.agent.agentItems, { chatId, items: [
      { key: "a", entry: { kind: "assistant", text: "Hel", streaming: true } },
      { key: "tool", entry: { kind: "tool", name: "Read", summary: "Read a.ts", status: "running" } },
    ] });
    await t.mutation(internal.comma.agent.agentItems, { chatId, items: [
      { key: "b", entry: { kind: "assistant", text: "Next", streaming: false } },
      { key: "a", entry: { kind: "assistant", text: "Hello", streaming: false } },
      { key: "end", entry: { kind: "turn_end", outcome: "completed", durationMs: 5 } },
    ] });
    expect((await items(chatId)).map(({ key, ordinal, entry }) => [key, ordinal, "text" in entry ? entry.text : entry.kind])).toEqual([
      ["u", 1, "u"], ["a", 2, "Hello"], ["tool", 3, "tool"], ["b", 4, "Next"], ["end", 5, "turn_end"],
    ]);
  });

  test("agentChat patches only the fields it is given", async () => {
    const { t, ask } = await setup();
    const chatId = await ask("k1");
    await t.mutation(internal.comma.agent.agentChat, { chatId, sessionId: "s1", seenThroughMessageAt: 10 });
    await t.mutation(internal.comma.agent.agentChat, { chatId, state: "running" });
    expect(await t.run((ctx) => ctx.db.get(chatId))).toMatchObject({ sessionId: "s1", seenThroughMessageAt: 10, state: "running" });
  });

  test("agentRecover interrupts open turns, cancels their questions, and is idempotent", async () => {
    const { t, as, conversationId, ask, items } = await setup();
    const running = await ask("k1");
    await t.mutation(internal.comma.agent.agentChat, { chatId: running, state: "waiting_input" });
    await t.mutation(internal.comma.agent.agentItems, { chatId: running, items: [{ key: "q1", entry: question("r1") }, { key: "q0", entry: question("r0", "resolved") }] });
    await as.mutation(api.comma.agent.newChat, { conversationId });
    const idle = await ask("k2");
    await t.mutation(internal.comma.agent.agentChat, { chatId: idle, state: "idle" });

    expect(await t.mutation(internal.comma.agent.agentRecover, { now: 50 })).toEqual({ chatIds: [running] });
    expect(await t.mutation(internal.comma.agent.agentRecover, { now: 60 })).toEqual({ chatIds: [] });
    expect(await t.run((ctx) => ctx.db.get(running))).toMatchObject({ state: "interrupted" });
    expect(await t.run((ctx) => ctx.db.get(idle))).toMatchObject({ state: "idle" });
    expect((await items(running)).map(({ key, entry }) => [key, entry.kind === "question" ? entry.status : entry.kind])).toEqual([
      ["k1", "user"], ["q1", "cancelled"], ["q0", "resolved"], ["recover-50", "turn_end"],
    ]);
    expect((await items(idle)).map(({ key }) => key)).toEqual(["k2"]);
  });

  test("agentRecover interrupts a pending chat whose command a dead runner took, and fails its running tool steps", async () => {
    const { t, as, conversationId, ask, items } = await setup();
    const stranded = await ask("k1");
    const [taken] = await t.query(api.comma.agent.pendingAgentCommands, { bridgeKey: SECRET });
    await t.mutation(internal.comma.agent.agentClaim, { ids: [taken._id] });
    await t.mutation(internal.comma.agent.agentItems, { chatId: stranded, items: [
      { key: "t1", entry: { kind: "tool", name: "Read", summary: "Read a.ts", status: "running" } },
      { key: "t0", entry: { kind: "tool", name: "Read", summary: "Read b.ts", status: "done" } },
    ] });
    await as.mutation(api.comma.agent.newChat, { conversationId });
    const queued = await ask("k2");

    expect(await t.mutation(internal.comma.agent.agentRecover, { now: 50 })).toEqual({ chatIds: [stranded] });
    expect(await t.run((ctx) => ctx.db.get(stranded))).toMatchObject({ state: "interrupted" });
    expect(await t.run((ctx) => ctx.db.get(queued))).toMatchObject({ state: "pending" });
    expect((await items(stranded)).map(({ key, entry }) => [key, entry.kind === "tool" ? entry.status : entry.kind])).toEqual([
      ["k1", "user"], ["t1", "failed"], ["t0", "done"], ["recover-50", "turn_end"],
    ]);
  });

  test("aiStatus reports the runner's latest heartbeat beside the Mini's capabilities", async () => {
    const { t, as } = await setup();
    await t.run((ctx) => ctx.db.insert("comma_bridge_state", {
      key: "mini", privateApi: true, suggestions: true, reactionSuggestions: false, whisperAvailable: false, lastSeenAt: 1,
    }));
    const status = () => as.query(api.comma.suggestions.aiStatus, {});
    expect(await status()).toEqual({ suggestions: true, reactionSuggestions: false, agentHeartbeatAt: null });
    await t.mutation(internal.comma.agent.agentHeartbeat, { now: 1_000 });
    expect((await status()).agentHeartbeatAt).toBe(1_000);
    await t.mutation(internal.comma.agent.agentHeartbeat, { now: 2_000 });
    expect((await status()).agentHeartbeatAt).toBe(2_000);
    expect(await t.run((ctx) => ctx.db.query("comma_bridge_state").collect())).toHaveLength(2);
    expect(await as.query(api.comma.bridgeState.bridgeState, {})).toMatchObject({ key: "mini", suggestions: true });
  });

  test("agentSend enqueues a send the way the composer does and leaves the user's draft alone", async () => {
    const { t, as, conversationId } = await setup();
    await as.mutation(api.comma.drafts.setDraft, { conversationId, text: "unsent" });
    const id = await t.mutation(internal.comma.agent.agentSend, { conversationId, clientKey: "agent-1", text: "hello" });
    expect(await t.mutation(internal.comma.agent.agentSend, { conversationId, clientKey: "agent-1", text: "hello" })).toBe(id);
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ payload: { kind: "send", text: "hello" }, status: "pending" });
    expect(await t.run((ctx) => ctx.db.query("comma_messages").collect())).toMatchObject([{ guid: "temp-agent-1", text: "hello" }]);
    expect(await as.query(api.comma.queries.getDraft, { conversationId })).toMatchObject({ text: "unsent", source: "user" });
  });
});

describe("POST /comma/ingest/agent*", () => {
  const post = (kind: string, body: unknown, token = SECRET) => ({
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  });

  test("rejects a wrong bearer token", async () => {
    const { t } = await setup();
    expect((await t.fetch("/comma/ingest/agentRecover", post("agentRecover", { now: 1 }, "wrong"))).status).toBe(401);
  });

  test("routes every agent kind to its function", async () => {
    const { t, conversationId, ask } = await setup();
    const chatId = await ask("k1");
    const [pending] = await t.query(api.comma.agent.pendingAgentCommands, { bridgeKey: SECRET });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"], { type: "image/png" })));
    const cases: [string, unknown, unknown][] = [
      ["agentClaim", { ids: [pending._id] }, [pending]],
      ["agentRecover", { now: 1 }, { chatIds: [chatId] }],
      ["agentChat", { chatId, state: "running" }, null],
      ["agentItems", { chatId, items: [{ key: "a", entry: { kind: "thinking", text: "hm", streaming: false } }] }, null],
      ["agentHeartbeat", { now: 1 }, null],
      ["agentRecordUpload", { storageId, filename: "a.png", mimeType: "image/png" }, { storageId, size: 5 }],
      ["agentDraft", { chatId, conversationId, itemKey: "d", text: "hi", attachments: [storageId] }, { placed: "composer" }],
      ["agentContext", { conversationId, limit: 40 }, { title: "Alex", participants: [{ name: "Alex", handles: ["+15550001111"] }], messages: [] }],
      ["agentSearch", { conversationId, query: "hi" }, []],
      ["agentPeople", { conversationId }, [{ address: "+15550001111", name: "Alex", handles: ["+15550001111"], tags: [], events: [] }]],
      ["agentAttachment", { guid: "missing" }, null],
      ["agentSend", { conversationId, clientKey: "c1", text: "hi" }, expect.any(String)],
    ];
    for (const [kind, body, result] of cases) {
      const response = await t.fetch(`/comma/ingest/${kind}`, post(kind, body));
      expect({ kind, status: response.status, body: await response.json() }).toEqual({ kind, status: 200, body: { ok: true, result } });
    }
    expect((await t.fetch("/comma/ingest/agentItems", post("agentItems", { chatId, items: [{ key: "x", entry: { kind: "nope" } }] }))).status).toBe(400);
  });
});
