import { expect, test } from "bun:test";
import type { AgentChat, AgentItem } from "../../client/src/lib/agent-api";
import { createAgentFixture } from "./agent";

function world(typed = "") {
  const written: Array<{ conversationId: string; text: string; note: string }> = [];
  const agent = createAgentFixture({
    userText: () => typed,
    writeAgentDraft: (conversationId, text, note) => { written.push({ conversationId, text, note }); },
  }, 0);
  const call = async <T>(name: string, args: Record<string, unknown>) => agent.handlers[`comma/agent:${name}`]!(args) as Promise<T>;
  const ask = (key: string, text: string) => call<string>("ask", { conversationId: "c1", key, text, steer: false, model: "claude-opus-5-5", effort: "high" });
  const items = async (chatId: string) => (await call<AgentItem[]>("listItems", { chatId })).map((item) => item.entry);
  return { agent, call, ask, items, written };
}
const tick = () => Bun.sleep(5);

test("an ask runs, then settles with a reply and two folded steps, and repeats of its key are ignored", async () => {
  const { call, ask, items } = world();
  const chatId = await ask("k1", "when did he first ask?");
  expect((await call<AgentChat>("liveChat", { conversationId: "c1" })).state).toBe("running");
  expect(await ask("k1", "when did he first ask?")).toBe(chatId);
  await tick();
  expect((await items(chatId)).map((entry) => entry.kind)).toEqual(["user", "tool", "tool", "assistant", "turn_end"]);
  expect((await call<AgentChat>("liveChat", { conversationId: "c1" })).state).toBe("idle");
});

test("a guest list ask waits on a question; the answer drafts into an empty composer", async () => {
  const { call, ask, items, written } = world();
  const chatId = await ask("k1", "add them to the guest list");
  await tick();
  const question = (await items(chatId)).find((entry) => entry.kind === "question");
  expect(question).toMatchObject({ status: "pending", questions: [{ options: [{ label: "Freaquency 10/31" }, { label: "Afterparty 11/1" }] }] });
  expect((await call<AgentChat>("liveChat", { conversationId: "c1" })).state).toBe("waiting_input");

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

test("stop cancels the pending turn and New chat leaves no live chat", async () => {
  const { call, ask, items } = world();
  const chatId = await ask("k1", "guest list");
  await call("stop", { chatId });
  await tick();
  expect((await items(chatId)).map((entry) => entry.kind)).toEqual(["user", "tool", "turn_end"]);
  await call("newChat", { conversationId: "c1" });
  expect(await call("liveChat", { conversationId: "c1" })).toBeNull();
  const next = await ask("k2", "hello again");
  expect(next).not.toBe(chatId);
});
