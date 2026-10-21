import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { Normalizer } from "./normalize";
import type { Item } from "./convex-port";

// Recorded shapes, trimmed to the fields the normalizer reads.
const sdk = (message: object) => message as SDKMessage;
const start = (id: string) => sdk({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id } } });
const blockStart = (index: number, type: "text" | "thinking") =>
  sdk({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_start", index, content_block: type === "text" ? { type, text: "" } : { type, thinking: "" } } });
const delta = (index: number, text: string, type: "text_delta" | "thinking_delta" = "text_delta") =>
  sdk({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index, delta: type === "text_delta" ? { type, text } : { type, thinking: text } } });
const assistant = (id: string, uuid: string, block: object, parent: string | null = null) =>
  sdk({ type: "assistant", uuid, parent_tool_use_id: parent, message: { id, content: [block] } });
const toolResult = (id: string, content: unknown, isError = false) =>
  sdk({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });
const result = (uuid: string, text: string, extra: object = {}) =>
  sdk({ type: "result", subtype: "success", uuid, result: text, is_error: false, duration_ms: 1200, queued_turn_count: 0, ...extra });

function run(normalizer: Normalizer, steps: [SDKMessage, number, boolean?][]): Item[] {
  return steps.flatMap(([message, now, steer]) => normalizer.consume(message, now, steer));
}

describe("Normalizer", () => {
  test("streams assistant text a paragraph at a time and finalizes it under the streamed key", () => {
    const items = run(new Normalizer(), [
      [start("msg_1"), 0],
      [blockStart(0, "text"), 0],
      [delta(0, "Added Jesse"), 10],
      [delta(0, " and Rebecca.\n\nThe reply"), 20],
      [delta(0, " is in the composer.\n\nAnything"), 100],
      [delta(0, " else?"), 600],
      [assistant("msg_1", "frame_1", { type: "text", text: "Added Jesse and Rebecca.\n\nThe reply is in the composer.\n\nAnything else?" }), 700],
    ]);
    expect(items).toEqual([
      { key: "msg_1:0", entry: { kind: "assistant", text: "Added Jesse and Rebecca.\n\n", streaming: true } },
      { key: "msg_1:0", entry: { kind: "assistant", text: "Added Jesse and Rebecca.\n\nThe reply is in the composer.\n\n", streaming: true } },
      { key: "msg_1:0", entry: { kind: "assistant", text: "Added Jesse and Rebecca.\n\nThe reply is in the composer.\n\nAnything else?", streaming: false } },
    ]);
  });

  test("pairs single-block assistant frames with their streamed blocks in order", () => {
    const items = run(new Normalizer(), [
      [start("msg_2"), 0],
      [blockStart(0, "thinking"), 0],
      [delta(0, "Checking the list.", "thinking_delta"), 1],
      [assistant("msg_2", "frame_a", { type: "thinking", thinking: "Checking the list." }), 2],
      [blockStart(1, "text"), 3],
      [delta(1, "Done."), 4],
      [assistant("msg_2", "frame_b", { type: "text", text: "Done." }), 5],
    ]);
    expect(items).toEqual([
      { key: "msg_2:0", entry: { kind: "thinking", text: "Checking the list.", streaming: false } },
      { key: "msg_2:1", entry: { kind: "assistant", text: "Done.", streaming: false } },
    ]);
  });

  test("emits tool steps with one-line summaries and settles them from their results", () => {
    const normalizer = new Normalizer();
    const items = run(normalizer, [
      [assistant("msg_3", "f1", { type: "tool_use", id: "tool_bash", name: "Bash", input: { command: "date +%S" } }), 0],
      [assistant("msg_3", "f2", { type: "tool_use", id: "tool_read", name: "Read", input: { file_path: "/Users/mimen/scratch/guests.csv" } }), 0],
      [assistant("msg_3", "f3", { type: "tool_use", id: "tool_search", name: "mcp__comma__search_thread", input: { query: "guest list" } }), 0],
      [toolResult("tool_bash", "42"), 1],
      [toolResult("tool_read", [{ type: "text", text: "no such file" }], true), 1],
    ]);
    const bash = { kind: "tool", name: "Bash", summary: "Ran: date +%S", input: '{"command":"date +%S"}', startedAt: 0 } as const;
    const read = { kind: "tool", name: "Read", summary: "Read guests.csv", input: '{"file_path":"/Users/mimen/scratch/guests.csv"}', startedAt: 0 } as const;
    expect(items).toEqual([
      { key: "tool_bash", entry: { ...bash, status: "running" } },
      { key: "tool_read", entry: { ...read, status: "running" } },
      { key: "tool_search", entry: { kind: "tool", name: "mcp__comma__search_thread", summary: "Searched: guest list", input: '{"query":"guest list"}', status: "running", startedAt: 0 } },
      { key: "tool_bash", entry: { ...bash, detail: "42", status: "done", endedAt: 1 } },
      { key: "tool_read", entry: { ...read, detail: "no such file", status: "failed", endedAt: 1 } },
    ]);
    expect(normalizer.flush(9, "failed")).toEqual([
      { key: "tool_search", entry: { kind: "tool", name: "mcp__comma__search_thread", summary: "Searched: guest list", input: '{"query":"guest list"}', status: "failed", startedAt: 0, endedAt: 9 } },
    ]);
  });

  const label = (name: string, input: object) =>
    new Normalizer().consume(assistant("m", "f", { type: "tool_use", id: "t", name, input }), 0)[0]?.entry;

  test("labels a step in plain words: the Bash description, a loaded skill, a Convex function", () => {
    expect(label("Bash", { command: "rg -n foo src | head", description: "Find where foo is used" })).toMatchObject({ summary: "Find where foo is used" });
    expect(label("Read", { file_path: "/Users/mimen/Documents/milad-vault/ClaudeConfig/skills/messaging/SKILL.md" })).toMatchObject({ summary: "Loaded messaging skill" });
    expect(label("Read", { file_path: "/Users/mimen/.claude/skills/auf/references/shotgun.md" })).toMatchObject({ summary: "Loaded auf skill" });
    expect(label("Skill", { skill: "todoist" })).toMatchObject({ summary: "Loaded todoist skill" });
    expect(label("Bash", {
      command: `bunx convex run --identity '{"subject":"agent","email":"m@x.com"}' comma/queries:getDraft '{"conversationId":"c1"}'`,
      description: "Check the draft",
    })).toMatchObject({ summary: "Ran getDraft" });
    expect(label("Bash", { command: "bunx convex run todoist:sync.runInitialSync" })).toMatchObject({ summary: "Ran runInitialSync" });
  });

  const hidden = (summary: string, startedAt = 0, endedAt?: number, name = "Bash"): Item["entry"] =>
    ({ kind: "tool", name, summary, status: endedAt === undefined ? "running" : "done", startedAt, ...(endedAt === undefined ? {} : { endedAt }) });
  const step = (command: string, description?: string) =>
    new Normalizer().consume(assistant("m", "f", { type: "tool_use", id: "t", name: "Bash", input: { command, ...(description ? { description } : {}) } }), 0)[0]?.entry;

  test("a credential step never stores its command, input, or output", () => {
    const normalizer = new Normalizer();
    const command = `op read "op://Sol/Todoist Env/notesPlain"`;
    const items = run(normalizer, [
      [assistant("m", "f", { type: "tool_use", id: "t_op", name: "Bash", input: { command, description: "Read the Todoist token" } }), 0],
      [toolResult("t_op", "TODOIST_TOKEN=abc123"), 4],
    ]);
    expect(items).toEqual([{ key: "t_op", entry: hidden("Used a credential") }, { key: "t_op", entry: hidden("Used a credential", 0, 4) }]);
    expect(JSON.stringify(items)).not.toMatch(/op:\/\/|abc123|Todoist token/);
  });

  test("any 1Password CLI call, a Keychain password lookup, or an op:// reference is a credential step", () => {
    const credentials = [
      "op item get Todoist --fields password", "op document get deploy-key > key.pem", "op inject -i env.tpl -o .env",
      "op run --env-file=.env -- bunx convex run todoist:sync.runInitialSync", "eval $(op signin)", "op whoami",
      "cd ~/x && OP_ACCOUNT=my op read x", `TOKEN=$(op read x) curl -H "Authorization: $TOKEN" api`, "/opt/homebrew/bin/op item list",
      "bash -c 'op read x'", "env OP_ACCOUNT=me op read x", "security find-generic-password -s todoist -w",
      "security find-internet-password -a me -w", `curl -H "$(cat headers)" "https://x.test/?ref=op://Sol/x"`, "echo hi | op inject",
    ];
    for (const command of credentials) expect({ command, entry: step(command) }).toEqual({ command, entry: hidden("Used a credential") });
    for (const command of ["git stop", "cat scope.txt", "echo top", "security list-keychains", "rg -n develop src", "ls ./op-notes"]) {
      expect({ command, shown: "input" in (step(command) ?? {}) }).toEqual({ command, shown: true });
    }
  });

  test("a credential step keeps a description that names no secret", () => {
    expect(step("op run --env-file=.env -- bun sync.ts", "Sync Todoist tasks")).toEqual(hidden("Sync Todoist tasks"));
    for (const description of ["Read the Todoist API key", "Get the deploy password", "Fetch op://Sol/x", "Load secrets", "Grab the token"]) {
      expect(step("op read x", description)).toEqual(hidden("Used a credential"));
    }
  });

  test("a backgrounded credential command's output stays hidden when it comes back later", () => {
    const normalizer = new Normalizer();
    const output = "/private/tmp/claude-501/tasks/b7k2q9x1.output";
    const items = run(normalizer, [
      [assistant("m", "f1", { type: "tool_use", id: "t_bg", name: "Bash", input: { command: "op read op://Sol/x", run_in_background: true } }), 0],
      [sdk({ type: "system", subtype: "task_started", task_id: "b7k2q9x1", tool_use_id: "t_bg", description: "op read op://Sol/x" }), 0],
      [toolResult("t_bg", `Command running in background with ID: b7k2q9x1. Output is being written to: ${output}`), 1],
      [sdk({ type: "system", subtype: "task_notification", task_id: "b7k2q9x1", tool_use_id: "t_bg", status: "completed", output_file: output, summary: "op read op://Sol/x" }), 2],
      [assistant("m", "f2", { type: "tool_use", id: "t_read", name: "Read", input: { file_path: output } }), 3],
      [toolResult("t_read", "sk-live-secret"), 4],
      [assistant("m", "f3", { type: "tool_use", id: "t_tail", name: "Bash", input: { command: `tail -5 ${output}`, description: "Check the output" } }), 5],
      [toolResult("t_tail", "sk-live-secret"), 6],
    ]);
    expect(items).toEqual([
      { key: "t_bg", entry: hidden("Used a credential") },
      { key: "t_bg", entry: hidden("Used a credential", 0, 1) },
      { key: "t_read", entry: hidden("Used a credential", 3, undefined, "Read") },
      { key: "t_read", entry: hidden("Used a credential", 3, 4, "Read") },
      { key: "t_tail", entry: hidden("Check the output", 5) },
      { key: "t_tail", entry: hidden("Check the output", 5, 6) },
    ]);
    expect(JSON.stringify(items)).not.toMatch(/sk-live|op:\/\/|b7k2q9x1/);
  });

  test("a credential command backgrounded by its task id alone is still tracked", () => {
    const normalizer = new Normalizer();
    const items = run(normalizer, [
      [assistant("m", "f1", { type: "tool_use", id: "t_bg", name: "Bash", input: { command: "op read x" } }), 0],
      [sdk({ type: "system", subtype: "task_started", task_id: "q1w2e3", tool_use_id: "t_bg", description: "op read x" }), 0],
      [assistant("m", "f2", { type: "tool_use", id: "t_read", name: "Read", input: { file_path: "/tmp/tasks/q1w2e3.output" } }), 3],
    ]);
    expect(items.at(-1)).toEqual({ key: "t_read", entry: hidden("Used a credential", 3, undefined, "Read") });
  });

  test("TodoWrite becomes one todos item per turn and no tool step", () => {
    const normalizer = new Normalizer();
    const todoWrite = (id: string, todos: object[]) => assistant("m", id, { type: "tool_use", id, name: "TodoWrite", input: { todos } });
    const items = run(normalizer, [
      [todoWrite("tw1", [{ content: "Read the thread", activeForm: "Reading the thread", status: "in_progress" }, { content: "Draft", status: "pending" }, { content: " ", status: "pending" }]), 0],
      [toolResult("tw1", "Todos have been modified"), 1],
      [todoWrite("tw2", [{ content: "Read the thread", status: "completed" }, { content: "Draft", status: "bogus" }]), 2],
      [result("r1", "done"), 3],
      [todoWrite("tw3", [{ content: "Next turn", status: "pending" }]), 4],
    ]);
    expect(items.filter((item) => item.entry.kind !== "turn_end")).toEqual([
      { key: "tw1:todos", entry: { kind: "todos", todos: [{ content: "Read the thread", activeForm: "Reading the thread", status: "in_progress" }, { content: "Draft", status: "pending" }] } },
      { key: "tw1:todos", entry: { kind: "todos", todos: [{ content: "Read the thread", status: "completed" }, { content: "Draft", status: "pending" }] } },
      { key: "tw3:todos", entry: { kind: "todos", todos: [{ content: "Next turn", status: "pending" }] } },
    ]);
  });

  test("a subagent's TodoWrite is not the root agent's list", () => {
    expect(run(new Normalizer(), [[assistant("m", "f", { type: "tool_use", id: "tw", name: "TodoWrite", input: { todos: [{ content: "x", status: "pending" }] } }, "task_1"), 0]])).toEqual([]);
  });

  test("leaves AskUserQuestion to the question item and ignores subagent frames", () => {
    const items = run(new Normalizer(), [
      [assistant("msg_4", "f1", { type: "tool_use", id: "ask_1", name: "AskUserQuestion", input: { questions: [] } }), 0],
      [toolResult("ask_1", "User answered"), 1],
      [assistant("msg_5", "f2", { type: "text", text: "subagent chatter" }, "task_1"), 2],
    ]);
    expect(items).toEqual([]);
  });

  test("hides ToolSearch, Claude Code's own lookup of deferred tools", () => {
    const items = run(new Normalizer(), [
      [assistant("msg_9", "f1", { type: "tool_use", id: "search_1", name: "ToolSearch", input: { query: "select:TodoWrite" } }), 0],
      [toolResult("search_1", "TodoWrite"), 1],
    ]);
    expect(items).toEqual([]);
  });

  test("a steer-induced empty result keeps the turn open and the steer's answer ends it", () => {
    const items = run(new Normalizer(), [
      [assistant("msg_6", "f1", { type: "tool_use", id: "tool_1", name: "Bash", input: { command: "date +%S" } }), 0],
      [result("result_steered", "", { queued_turn_count: 0 }), 10, true],
      [assistant("msg_7", "f2", { type: "text", text: "STEERED" }), 20],
      [result("result_final", "STEERED"), 30, false],
    ]);
    expect(items.filter((item) => item.entry.kind === "turn_end")).toEqual([
      { key: "result_final", entry: { kind: "turn_end", outcome: "completed", durationMs: 1200 } },
    ]);
  });

  test("a result with queued sends behind it is not a turn end even without a pending steer", () => {
    const normalizer = new Normalizer();
    expect(normalizer.consume(result("r1", "first answer", { queued_turn_count: 1 }), 0)).toEqual([]);
    expect(normalizer.consume(result("r2", "second answer"), 1)).toEqual([
      { key: "r2", entry: { kind: "turn_end", outcome: "completed", durationMs: 1200 } },
    ]);
  });

  test("a non-empty result while a steer is pending still ends the turn", () => {
    expect(new Normalizer().consume(result("r3", "finished before the steer"), 0, true)).toEqual([
      { key: "r3", entry: { kind: "turn_end", outcome: "completed", durationMs: 1200 } },
    ]);
  });

  test("an error result ends the turn as failed with the SDK's errors", () => {
    const failed = sdk({ type: "result", subtype: "error_during_execution", uuid: "r4", is_error: true, duration_ms: 5, errors: ["gateway 502"] });
    expect(new Normalizer().consume(failed, 0)).toEqual([
      { key: "r4", entry: { kind: "turn_end", outcome: "failed", durationMs: 5, error: "gateway 502" } },
    ]);
  });

  test("flush finalizes a paragraph cut off by an interrupt", () => {
    const normalizer = new Normalizer();
    run(normalizer, [[start("msg_8"), 0], [blockStart(0, "text"), 0], [delta(0, "Half a thou"), 1]]);
    expect(normalizer.flush(2)).toEqual([{ key: "msg_8:0", entry: { kind: "assistant", text: "Half a thou", streaming: false } }]);
    expect(normalizer.flush(3)).toEqual([]);
  });
});
