import { describe, expect, test } from "bun:test";
import { AgentSession } from "./session";
import { fakeQueries, sdkResult, sdkText, settle } from "./query-fake";
import type { AgentChatState, Item } from "./convex-port";

function harness() {
  const { query, queries } = fakeQueries();
  const items: Item[] = [];
  const states: AgentChatState[] = [];
  const errors: unknown[] = [];
  let now = 1_000;
  const session = new AgentSession({
    sessionId: "session-1",
    options: { model: "claude-opus-5-5" },
    query,
    now: () => now,
    writeItems: async (batch) => { items.push(...batch); },
    writeState: async (state) => { states.push(state); },
    onError: (error) => errors.push(error),
  });
  return { session, sdk: queries[0], items, states, errors, advance: (ms: number) => { now += ms; } };
}

const turnEnds = (items: Item[]) => items.filter((item) => item.entry.kind === "turn_end").map((item) => item.entry);
const question = { question: "Which list?", header: "List", multiSelect: true, options: [{ label: "Freaquency 10/31" }, { label: "Afterparty 11/1" }] };

describe("AgentSession", () => {
  test("a message runs one turn and the result returns the chat to idle", async () => {
    const { session, sdk, items, states } = harness();
    await session.send("add them to the guest list", false);
    await settle();
    expect(sdk.sent).toEqual([{ type: "user", message: { role: "user", content: "add them to the guest list" }, parent_tool_use_id: null, session_id: "session-1" }]);
    expect(session.state.kind).toBe("running");
    sdk.emit(sdkText("m1", "Done."));
    sdk.emit(sdkResult("r1", "Done."));
    await settle();
    expect(session.state.kind).toBe("idle");
    expect(states).toEqual(["running", "idle"]);
    expect(turnEnds(items)).toEqual([{ kind: "turn_end", outcome: "completed", durationMs: 10 }]);
  });

  test("a steer mid-turn goes in with priority now and its empty result does not end the turn", async () => {
    const { session, sdk, items, states } = harness();
    await session.send("make six calls", false);
    await session.send("stop now and say STEERED", true);
    await settle();
    expect(sdk.sent[1]).toMatchObject({ priority: "now", message: { content: "stop now and say STEERED" } });
    sdk.emit(sdkResult("r-steered", ""));
    await settle();
    expect(session.state.kind).toBe("running");
    expect(turnEnds(items)).toEqual([]);
    sdk.emit(sdkText("m2", "STEERED"));
    sdk.emit(sdkResult("r-final", "STEERED"));
    await settle();
    expect(states).toEqual(["running", "idle"]);
    expect(turnEnds(items)).toHaveLength(1);
  });

  test("a plain message mid-turn queues behind it without priority", async () => {
    const { session, sdk } = harness();
    await session.send("first", false);
    await session.send("second", false);
    await settle();
    expect(sdk.sent[1]).not.toHaveProperty("priority");
    sdk.emit(sdkResult("r1", "first done", { queued_turn_count: 1 }));
    await settle();
    expect(session.state.kind).toBe("running");
  });

  test("AskUserQuestion waits for the answer and returns it as updatedInput.answers", async () => {
    const { session, sdk, items, states } = harness();
    await session.send("add them", false);
    const decision = sdk.askTool("AskUserQuestion", { questions: [question] }, "toolu_ask");
    await settle();
    expect(session.state.kind).toBe("waiting_input");
    expect(items.at(-1)).toEqual({ key: "toolu_ask", entry: { kind: "question", requestId: "toolu_ask", questions: [question], status: "pending" } });
    await session.answer("toolu_ask", { "Which list?": ["Freaquency 10/31", "Afterparty 11/1"] });
    expect(await decision).toEqual({
      behavior: "allow",
      updatedInput: { questions: [question], answers: { "Which list?": "Freaquency 10/31, Afterparty 11/1" } },
    });
    expect(items.at(-1)?.entry).toMatchObject({ kind: "question", status: "resolved", answers: { "Which list?": "Freaquency 10/31, Afterparty 11/1" } });
    expect(states).toEqual(["running", "waiting_input", "running"]);
  });

  test("other tools are allowed untouched under bypassPermissions", async () => {
    const { sdk } = harness();
    expect(await sdk.askTool("Bash", { command: "date" }, "toolu_bash")).toEqual({ behavior: "allow", updatedInput: { command: "date" } });
  });

  test("Stop interrupts then closes the query, cancels the pending question, and ignores late output", async () => {
    const { session, sdk, items, states, advance } = harness();
    await session.send("add them", false);
    const decision = sdk.askTool("AskUserQuestion", { questions: [question] }, "toolu_ask");
    await settle();
    advance(5_000);
    await session.interrupt();
    expect(sdk.calls).toEqual(["interrupt", "close"]);
    expect(await decision).toMatchObject({ behavior: "deny" });
    expect(items.find((item) => item.key === "toolu_ask" && item.entry.kind === "question" && item.entry.status === "cancelled")).toBeDefined();
    expect(turnEnds(items)).toEqual([{ kind: "turn_end", outcome: "interrupted", durationMs: 5_000 }]);
    expect(states.at(-1)).toBe("interrupted");
    expect(session.live).toBe(false);
    await expect(session.send("again", false)).rejects.toThrow("ended");
  });

  test("an error result fails the turn and ends the process so the next message resumes", async () => {
    const { session, sdk, items, states } = harness();
    await session.send("go", false);
    sdk.emit({ type: "result", subtype: "error_during_execution", uuid: "r1", is_error: true, duration_ms: 3, errors: ["gateway 502"] });
    await settle();
    expect(states).toEqual(["running", "failed"]);
    expect(turnEnds(items)).toEqual([{ kind: "turn_end", outcome: "failed", durationMs: 3, error: "gateway 502" }]);
    expect(sdk.closed).toBe(true);
  });

  test("a crashed stream mid-turn ends the turn as failed", async () => {
    const { session, sdk, items, states, errors } = harness();
    await session.send("go", false);
    sdk.fail(new Error("spawn bun ENOENT"));
    await settle();
    expect(states.at(-1)).toBe("failed");
    expect(turnEnds(items)).toEqual([{ kind: "turn_end", outcome: "failed", durationMs: 0, error: "spawn bun ENOENT" }]);
    expect(errors).toHaveLength(1);
    expect(session.live).toBe(false);
  });

  test("every turn end settles the tool steps still running: done on completion, failed otherwise", async () => {
    const toolUse = (id: string) => ({ type: "assistant", uuid: `${id}-frame`, parent_tool_use_id: null, message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Read", input: { file_path: "/a.ts" } }] } });
    const toolStatus = (items: Item[], key: string) => items.filter((item) => item.key === key).map((item) => item.entry.kind === "tool" ? item.entry.status : item.entry.kind).at(-1);
    const ends = {
      completed: (sdk: ReturnType<typeof harness>["sdk"]) => sdk.emit(sdkResult("r1", "done")),
      failed: (sdk: ReturnType<typeof harness>["sdk"]) => sdk.fail(new Error("spawn bun ENOENT")),
      interrupted: (_sdk: ReturnType<typeof harness>["sdk"], session: AgentSession) => session.interrupt(),
    };
    const outcomes: Record<string, string | undefined> = {};
    for (const [outcome, end] of Object.entries(ends)) {
      const { session, sdk, items } = harness();
      await session.send("go", false);
      sdk.emit(toolUse("toolu_r"));
      await settle();
      expect(toolStatus(items, "toolu_r")).toBe("running");
      await end(sdk, session);
      await settle();
      outcomes[outcome] = toolStatus(items, "toolu_r");
    }
    expect(outcomes).toEqual({ completed: "done", failed: "failed", interrupted: "failed" });
  });

  test("closing an idle session leaves the chat idle", async () => {
    const { session, sdk, states } = harness();
    await session.close();
    expect(sdk.closed).toBe(true);
    expect(session.state).toEqual({ kind: "ended", outcome: "closed" });
    expect(states).toEqual([]);
  });
});
