import { expect, test } from "bun:test";
import type { AgentChatSummary, AgentItem } from "../../client/src/lib/agent-api";
import { createAgentFixture, GUEST_LIST_OUTPUT, TURN_MS } from "./agent";

function world(typed = "") {
  const written: Array<{ conversationId: string; text: string; note: string }> = [];
  const agent = createAgentFixture({
    userText: () => typed,
    writeAgentDraft: (conversationId, text, note) => { written.push({ conversationId, text, note }); },
    upload: (storageId) => storageId === "stored" ? { filename: "shot.png", mimeType: "image/png", size: 9 } : null,
  }, 0);
  const call = async <T>(name: string, args: Record<string, unknown>) => agent.handlers[`comma/agent:${name}`]!(args) as Promise<T>;
  const ask = (key: string, text: string, extra: Record<string, unknown> = {}) =>
    call<string>("ask", { conversationId: "c1", key, text, steer: false, model: "claude-opus-5-5", effort: "high", ...extra });
  const items = async (chatId: string) => (await call<AgentItem[]>("listItems", { chatId })).map((item) => item.entry);
  const chats = () => call<AgentChatSummary[]>("chatsFor", { conversationId: "c1" });
  const chat = async (chatId: string) => (await chats()).find((row) => row._id === chatId)!;
  return { agent, call, ask, items, chats, chat, written };
}
const tick = () => Bun.sleep(5);

test("an ask runs with a checklist and a thought, then settles with nine steps, a reply and a measured end", async () => {
  const { chat, ask, items } = world();
  const chatId = await ask("k1", "when did he first ask?");
  expect((await chat(chatId)).state).toBe("running");
  expect((await items(chatId)).map((entry) => entry.kind)).toEqual(["user", "todos", "thinking", "tool", "tool"]);
  expect(await ask("k1", "when did he first ask?")).toBe(chatId);
  await tick();
  const entries = await items(chatId);
  expect(entries.filter((entry) => entry.kind === "tool")).toHaveLength(9);
  expect(entries.find((entry) => entry.kind === "tool" && entry.name === "Bash")).toMatchObject({ input: JSON.stringify({ command: "bun scripts/guest-list.ts --upcoming", description: "Check the guest lists" }), detail: GUEST_LIST_OUTPUT });
  expect(entries.find((entry) => entry.kind === "todos")).toMatchObject({ todos: [{ status: "completed" }, { status: "completed" }, { status: "completed" }] });
  expect(entries.at(-1)).toEqual({ kind: "turn_end", outcome: "completed", durationMs: TURN_MS, model: "claude-opus-5-5", effort: "high" });
  expect(await chat(chatId)).toMatchObject({ state: "idle", title: "when did he first ask?", lastTurnEndedAt: expect.any(Number), preview: { kind: "reply" } });
});

test("an ask carries finalized files for display and runs on its own selection", async () => {
  const { ask, items } = world();
  const chatId = await ask("k1", "what is this?", { model: "claude-sonnet-5-5", effort: "low", attachments: [{ storageId: "stored", filename: "shot.png", mimeType: "image/png", size: 9 }] });
  expect((await items(chatId))[0]).toEqual({ kind: "user", text: "what is this?", steer: false, attachments: [{ filename: "shot.png", mimeType: "image/png", size: 9 }] });
  await tick();
  expect((await items(chatId)).at(-1)).toMatchObject({ kind: "turn_end", model: "claude-sonnet-5-5", effort: "low" });
  await expect(ask("k2", "and this?", { attachments: [{ storageId: "missing", filename: "x.png", mimeType: "image/png", size: 1 }] })).rejects.toThrow("Finalized upload not found");
});

test("take your time keeps working until Stop, which ends the turn with its duration", async () => {
  const { call, chat, ask, items } = world();
  const chatId = await ask("k1", "take your time");
  await tick();
  expect((await chat(chatId)).state).toBe("running");
  await call("stop", { chatId });
  const entries = await items(chatId);
  expect(entries.at(-1)).toMatchObject({ kind: "turn_end", outcome: "interrupted", durationMs: expect.any(Number) });
  expect(entries.some((entry) => (entry.kind === "tool" && entry.status === "running") || (entry.kind === "thinking" && entry.streaming))).toBe(false);
});

test("a guest list ask waits on a question; the answer drafts into an empty composer", async () => {
  const { call, chat, ask, items, written } = world();
  const chatId = await ask("k1", "add them to the guest list");
  await tick();
  const question = (await items(chatId)).find((entry) => entry.kind === "question");
  expect(question).toMatchObject({ status: "pending", questions: [{ options: [{ label: "Freaquency 10/31" }, { label: "Afterparty 11/1" }] }] });
  expect(await chat(chatId)).toMatchObject({ state: "waiting_input", preview: { kind: "question", text: "Which list?" } });

  await call("answer", { chatId, requestId: "k1-turn-question", answers: { "Which list?": "Freaquency 10/31" } });
  await tick();
  expect(written).toEqual([{ conversationId: "c1", text: "You're both on the list for Freaquency 10/31 🎃 see you there", note: "Added Jesse + Rebecca to Freaquency 10/31" }]);
  expect((await items(chatId)).find((entry) => entry.kind === "draft")).toMatchObject({ placed: "composer", used: false });
});

test("when the user has typed, the draft waits in the pane until Use in composer", async () => {
  const { call, ask, written } = world("hold on");
  const chatId = await ask("k1", "guest list please");
  await tick();
  await call("answer", { chatId, requestId: "k1-turn-question", answers: { "Which list?": "Afterparty 11/1" } });
  await tick();
  expect(written).toEqual([]);
  const draft = (await call<AgentItem[]>("listItems", { chatId })).find((item) => item.entry.kind === "draft")!;
  expect(draft.entry).toMatchObject({ placed: "pane", used: false });

  await call("useDraft", { itemId: draft._id });
  expect(written.map((row) => row.text)).toEqual(["You're both on the list for Afterparty 11/1 🎃 see you there"]);
  expect((await call<AgentItem[]>("listItems", { chatId })).find((item) => item.key === draft.key)?.entry).toMatchObject({ used: true });
});

test("settling a waiting chat stops its turn; an ask without a chat starts another, one naming it reopens it", async () => {
  const { call, chat, chats, ask, items } = world();
  const chatId = await ask("k1", "guest list");
  await tick();
  await call("settle", { chatId });
  expect(await chat(chatId)).toMatchObject({ state: "interrupted", settledAt: expect.any(Number) });
  expect((await items(chatId)).find((entry) => entry.kind === "question")).toMatchObject({ status: "cancelled" });
  expect(await call("listAgentChats", {})).toEqual([]);

  const next = await ask("k2", "hello again");
  expect(next).not.toBe(chatId);
  expect(await ask("k3", "back to the list", { chatId })).toBe(chatId);
  expect((await chat(chatId)).settledAt).toBeUndefined();
  expect((await chats()).map((row) => row._id).sort()).toEqual([chatId, next].sort());
});

test("markSeen clears ready only after a turn ends, and a settled chat that asks reopens", async () => {
  const { call, chat, ask } = world();
  const chatId = await ask("k1", "add them to the guest list");
  await call("markSeen", { chatId });
  expect((await chat(chatId)).seenAt).toBeUndefined();
  await call("settle", { chatId });
  await tick();
  expect(await chat(chatId)).toMatchObject({ state: "waiting_input", settledAt: undefined });

  await call("answer", { chatId, requestId: "k1-turn-question", answers: { "Which list?": "Afterparty 11/1" } });
  await tick();
  const ended = await chat(chatId);
  expect(ended.lastTurnEndedAt).toEqual(expect.any(Number));
  await call("markSeen", { chatId });
  expect((await chat(chatId)).seenAt).toBeGreaterThanOrEqual(ended.lastTurnEndedAt!);
});
