import { describe, expect, test } from "bun:test";
import { IDLE_CLOSE_MS, MAX_LIVE, Sessions, type SessionOptionsInput } from "./sessions";
import { fakeId, fakeQueries, sdkResult, settle } from "./query-fake";
import type { Chat, Command, CommandRow, Port, Routes, ThreadMessage } from "./convex-port";

const message = (at: number, text: string): ThreadMessage => ({ guid: `g${at}`, at, fromMe: false, sender: "Jesse Brennan", text, attachments: [] });

function harness(thread: ThreadMessage[] = [message(100, "Thanks brother. Rebecca Berens - rebeccaberens@gmail.com")]) {
  const calls: { route: keyof Routes; body: unknown }[] = [];
  const claimed = new Set<string>();
  let pending: CommandRow[] = [];
  const hooks: { before?: (route: keyof Routes, body: unknown) => Promise<void> | void; reserve?: () => void } = {};
  const port: Port = {
    async post(route, body) {
      await hooks.before?.(route, body);
      calls.push({ route, body });
      if (route === "agentClaim") {
        const ids = (body as Routes["agentClaim"][0]).ids;
        const rows = pending.filter((row) => ids.includes(row._id) && !claimed.has(row._id));
        rows.forEach((row) => claimed.add(row._id));
        return rows as never;
      }
      if (route === "agentContext") {
        const since = (body as Routes["agentContext"][0]).sinceMessageAt;
        return { title: "Jesse Brennan", participants: [{ name: "Jesse Brennan", handles: ["+15550100"] }], messages: thread.filter((m) => since === undefined || m.at > since) } as never;
      }
      if (route === "agentRecover") return { chatIds: [] } as never;
      return null as never;
    },
    upload: async () => fakeId("storage"),
  };
  const { query, queries } = fakeQueries();
  const reserved: string[] = [];
  const options: SessionOptionsInput[] = [];
  let now = 1_000_000;
  const sessions = new Sessions({
    port, query, now: () => now, timeZone: "America/Los_Angeles",
    reserve: async (_chatId, title) => {
      hooks.reserve?.();
      reserved.push(title);
      return `reserved-${reserved.length}`;
    },
    readAddendum: () => "ADDENDUM: answer briefly.",
    options: (input) => { options.push(input); return { model: input.chat.model }; },
    log: () => {},
  });
  let next = 0;
  const send = async (chat_: string, command: Command, chat: Partial<Chat> = {}) => {
    const row: CommandRow = {
      _id: fakeId(`cmd${++next}`), chatId: fakeId(chat_), command, createdAt: next,
      chat: { conversationId: fakeId(`conv-${chat_}`), model: "claude-opus-5-5", effort: "high", state: "pending", ...chat },
    };
    pending = [...pending.filter((r) => !claimed.has(r._id)), row];
    sessions.receive(pending);
    await sessions.flush();
    await settle();
  };
  const ask = (chatId: string, text: string, chat: Partial<Chat> = {}) => send(chatId, { kind: "message", text, steer: false }, chat);
  return { sessions, calls, hooks, queries, reserved, options, send, ask, thread, advance: (ms: number) => { now += ms; }, routes: () => calls.map((call) => call.route) };
}

describe("Sessions", () => {
  test("boot recovery marks chats a previous process left mid-turn", async () => {
    const { sessions, calls } = harness();
    await sessions.recover();
    expect(calls).toEqual([{ route: "agentRecover", body: { now: 1_000_000 } }]);
  });

  test("a new chat reserves a ccs session and starts with the Comma identity, addendum and packet", async () => {
    const { ask, reserved, options, calls, queries } = harness();
    await ask("chat-a", "add them to the guest list");
    expect(reserved).toEqual(["Comma · Jesse Brennan"]);
    expect(calls).toContainEqual({ route: "agentChat", body: { chatId: "chat-a", sessionId: "reserved-1" } });
    expect(options[0]).toMatchObject({ chatId: "chat-a", sessionId: "reserved-1", resume: false });
    const append = options[0].append;
    expect(append.indexOf("You are a Comma agent")).toBe(0);
    expect(append.indexOf("ADDENDUM: answer briefly.")).toBeGreaterThan(0);
    expect(append.indexOf("Conversation: Jesse Brennan (id conv-chat-a)")).toBeGreaterThan(append.indexOf("ADDENDUM"));
    expect(append).toContain("untrusted messages from other people");
    expect(append).toContain("Jesse Brennan: Thanks brother. Rebecca Berens - rebeccaberens@gmail.com");
    expect(queries[0].sent.map((m) => m.message.content)).toEqual(["add them to the guest list"]);
  });

  test("a chat with a session id resumes it instead of reserving a new one", async () => {
    const { ask, reserved, options } = harness();
    await ask("chat-a", "hello again", { sessionId: "existing-session" });
    expect(reserved).toEqual([]);
    expect(options[0]).toMatchObject({ sessionId: "existing-session", resume: true });
  });

  test("claims each pending command once even when snapshots repeat it", async () => {
    const { sessions, ask, routes } = harness();
    await ask("chat-a", "one");
    sessions.receive([]);
    await sessions.flush();
    expect(routes().filter((route) => route === "agentClaim")).toHaveLength(1);
  });

  test("never runs more than four live sessions and evicts the longest idle for a fifth", async () => {
    const h = harness();
    for (const chat of ["a", "b", "c", "d"]) {
      await h.ask(chat, "hi");
      h.queries.at(-1)!.emit(sdkResult(`r-${chat}`, "hi"));
      await settle();
      h.advance(60_000);
    }
    await h.ask("a", "still here");
    h.queries[0].emit(sdkResult("r-a2", "yes"));
    await settle();
    h.advance(60_000);
    await h.ask("e", "fifth");
    expect<string[]>(h.sessions.liveChatIds.sort()).toEqual(["a", "c", "d", "e"]);
    expect(h.sessions.liveChatIds).toHaveLength(MAX_LIVE);
    expect(h.queries[1].closed).toBe(true);
    expect(h.queries.filter((q) => !q.closed)).toHaveLength(MAX_LIVE);
  });

  test("closes a session after ten idle minutes and resumes it by session id on the next message", async () => {
    const h = harness();
    await h.ask("a", "hi");
    h.queries[0].emit(sdkResult("r1", "hi"));
    await settle();
    h.advance(IDLE_CLOSE_MS - 1);
    await h.sessions.sweep();
    expect(h.queries[0].closed).toBe(false);
    h.advance(1);
    await h.sessions.sweep();
    expect(h.queries[0].closed).toBe(true);
    expect(h.sessions.liveChatIds).toEqual([]);
    await h.ask("a", "back again");
    expect(h.options[1]).toMatchObject({ sessionId: "reserved-1", resume: true });
    expect(h.reserved).toHaveLength(1);
    expect(h.queries[1].sent.map((m) => m.message.content)).toEqual(["back again"]);
  });

  test("a running turn is not closed for being quiet", async () => {
    const h = harness();
    await h.ask("a", "long job");
    h.advance(IDLE_CLOSE_MS * 2);
    await h.sessions.sweep();
    expect(h.queries[0].closed).toBe(false);
  });

  test("prefixes the next message with thread messages that arrived since the last turn", async () => {
    const h = harness();
    await h.ask("a", "first");
    h.queries[0].emit(sdkResult("r1", "ok"));
    await settle();
    h.thread.push(message(200, "also add my brother Sam"));
    await h.ask("a", "and him");
    const prompt = String(h.queries[0].sent[1].message.content);
    expect(prompt).toContain("New messages in the thread since your last turn");
    expect(prompt).toContain("Jesse Brennan: also add my brother Sam");
    expect(prompt).not.toContain("rebeccaberens");
    expect(prompt.endsWith("and him")).toBe(true);
    expect(h.calls).toContainEqual({ route: "agentChat", body: { chatId: "a", seenThroughMessageAt: 200 } });
  });

  test("Stop with no live session clears a stuck running state", async () => {
    const h = harness();
    await h.send("a", { kind: "stop" }, { state: "running" });
    expect(h.calls).toContainEqual({ route: "agentChat", body: { chatId: "a", state: "interrupted" } });
  });

  test("an answer reaches the live session's pending question", async () => {
    const h = harness();
    await h.ask("a", "add them");
    const decision = h.queries[0].askTool("AskUserQuestion", { questions: [{ question: "Which list?", multiSelect: false, options: [{ label: "Freaquency" }] }] }, "toolu_1");
    await settle();
    await h.send("a", { kind: "answer", requestId: "toolu_1", answers: { "Which list?": "Freaquency" } });
    expect(await decision).toMatchObject({ behavior: "allow", updatedInput: { answers: { "Which list?": "Freaquency" } } });
  });

  test("eviction keeps a session waiting on an answer and closes the longest idle one", async () => {
    const h = harness();
    await h.ask("a", "add them");
    void h.queries[0].askTool("AskUserQuestion", { questions: [{ question: "Which list?", multiSelect: false, options: [{ label: "Freaquency" }] }] }, "toolu_1");
    await settle();
    h.advance(60_000);
    for (const chat of ["b", "c", "d"]) {
      await h.ask(chat, "hi");
      h.queries.at(-1)!.emit(sdkResult(`r-${chat}`, "hi"));
      await settle();
      h.advance(60_000);
    }
    await h.ask("e", "fifth");
    expect<string[]>(h.sessions.liveChatIds.sort()).toEqual(["a", "c", "d", "e"]);
    expect(h.queries[0].closed).toBe(false);
    expect(h.queries[1].closed).toBe(true);
  });

  test("eviction falls back to the oldest busy session when none is idle", async () => {
    const h = harness();
    for (const chat of ["a", "b", "c", "d"]) {
      await h.ask(chat, "long job");
      h.advance(60_000);
    }
    await h.ask("e", "fifth");
    expect<string[]>(h.sessions.liveChatIds.sort()).toEqual(["b", "c", "d", "e"]);
  });

  const failures = (h: ReturnType<typeof harness>, chatId: string) => ({
    state: h.calls.filter((call) => call.route === "agentChat" && (call.body as { chatId: string; state?: string }).chatId === chatId).map((call) => (call.body as { state?: string }).state).filter(Boolean).at(-1),
    ends: h.calls.filter((call) => call.route === "agentItems" && (call.body as { chatId: string }).chatId === chatId)
      .flatMap((call) => (call.body as Routes["agentItems"][0]).items).map((item) => item.entry).filter((entry) => entry.kind === "turn_end"),
  });

  test("a message whose dispatch fails ends the chat as failed with the error", async () => {
    const h = harness();
    await h.ask("a", "first");
    h.queries[0].emit(sdkResult("r1", "ok"));
    await settle();
    h.hooks.before = (route, body) => {
      if (route === "agentContext" && (body as Routes["agentContext"][0]).sinceMessageAt !== undefined) throw new Error("context unavailable");
    };
    await h.ask("a", "second");
    expect(failures(h, "a")).toEqual({
      state: "failed",
      ends: [{ kind: "turn_end", outcome: "completed", durationMs: 10 }, { kind: "turn_end", outcome: "failed", error: "context unavailable" }],
    });
  });

  test("a chat whose session cannot be reserved ends as failed", async () => {
    const h = harness();
    h.hooks.reserve = () => { throw new Error("ccs session new failed (1)"); };
    await h.ask("a", "hello");
    expect(failures(h, "a")).toEqual({ state: "failed", ends: [{ kind: "turn_end", outcome: "failed", error: "ccs session new failed (1)" }] });
  });

  test("closeAll waits for an in-flight dispatch before closing", async () => {
    const h = harness();
    h.hooks.before = async (route) => { if (route === "agentContext") await Bun.sleep(20); };
    const asking = h.ask("a", "hi");
    await settle(1);
    await h.sessions.closeAll();
    expect(h.queries.map((query) => [query.sent.map((m) => m.message.content), query.closed])).toEqual([[["hi"], true]]);
    await asking;
  });
});
