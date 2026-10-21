import { describe, expect, test } from "bun:test";
import type { AgentEntry, AgentItem, AgentQuestion } from "./agent-api";
import {
  formatWorking,
  liveStatus,
  promptHistory,
  stepInput,
  stepLabel,
  stepOutput,
  stepPromptHistory,
  stoppedLabel,
  summarizeSteps,
  type TranscriptRow,
  EMPTY_SELECTION,
  questionAnswers,
  questionShortcut,
  toggleOption,
  toggleOther,
  transcriptRows,
} from "./agent-transcript";

let ordinal = 0;
function item(entry: AgentEntry, at = ordinal * 1000, updatedAt = at): AgentItem {
  ordinal += 1;
  return {
    _id: `item-${ordinal}` as AgentItem["_id"], _creationTime: at, chatId: "chat" as AgentItem["chatId"],
    key: `k${ordinal}`, ordinal, entry, createdAt: at, updatedAt,
  };
}
const tool = (status: "running" | "done" | "failed", name = "Bash") => item({ kind: "tool", name, summary: "ran a command", status });
const user = (text: string, steer = false) => item({ kind: "user", text, steer });
const assistant = (text: string) => item({ kind: "assistant", text, streaming: false });
const thinking = (text: string, streaming = false) => item({ kind: "thinking", text, streaming });
const question = () => item({ kind: "question", requestId: "q", status: "pending", questions: [] });
const end = (outcome: "completed" | "interrupted" | "failed", durationMs?: number) =>
  item({ kind: "turn_end", outcome, ...(durationMs === undefined ? {} : { durationMs }), ...(outcome === "failed" ? { error: "boom" } : {}) });

function shape(rows: readonly TranscriptRow[]): unknown[] {
  return rows.map((row) => row.kind === "work" ? `work:${row.summary}` : row.kind === "turn" ? { [row.label]: shape(row.rows) } : row.item.entry.kind);
}
const rowsOf = (items: AgentItem[]) => shape(transcriptRows(items));

describe("a running turn", () => {
  test("consecutive steps and the thinking between them read as one row of verbs", () => {
    expect(rowsOf([user("go"), tool("done"), thinking("hm"), tool("done", "Read"), tool("running")]))
      .toEqual(["user", "work:Ran 2 commands and read 1 file"]);
  });

  test("a failed step and a question break the run and stay visible", () => {
    expect(rowsOf([user("go"), tool("done"), tool("failed"), tool("done"), question(), tool("done")]))
      .toEqual(["user", "work:Ran 1 command", "tool", "work:Ran 1 command", "question", "work:Ran 1 command"]);
  });

  test("thinking without a step is not a work row", () => {
    expect(rowsOf([user("hi"), thinking("hm")])).toEqual(["user", "thinking"]);
  });

  test("a row still running says so", () => {
    const [, row] = transcriptRows([user("go"), tool("done"), tool("running")]);
    expect(row).toMatchObject({ kind: "work", running: true });
  });
});

describe("a finished turn", () => {
  test("folds its steps, thinking and interim replies behind one Worked for row, keeping the last reply", () => {
    expect(rowsOf([user("go"), tool("done"), assistant("checking"), thinking("hm"), tool("done", "Read"), assistant("done"), end("completed", 125_000)]))
      .toEqual(["user", { "Worked for 2m 5s": ["work:Ran 1 command", "assistant", "work:Read 1 file"] }, "assistant"]);
  });

  test("a stopped turn reads You stopped after, and its own end row goes", () => {
    expect(rowsOf([user("go"), thinking("hm"), tool("done"), end("interrupted", 12_000)]))
      .toEqual(["user", { "You stopped after 12s": ["work:Ran 1 command"] }]);
  });

  test("a stopped turn with nothing to fold keeps its end row", () => {
    expect(rowsOf([user("go"), end("interrupted", 900)])).toEqual(["user", "turn_end"]);
    expect(stoppedLabel(900)).toBe("You stopped after 900ms");
    expect(stoppedLabel(undefined)).toBe("You stopped this response");
  });

  test("failures, questions, drafts, the checklist and steers stay in view; a failed end keeps its error", () => {
    const todos = item({ kind: "todos", todos: [{ content: "Read the thread", status: "completed" }] });
    const draft = item({ kind: "draft", text: "hey", placed: "pane", used: false });
    expect(rowsOf([user("go"), todos, tool("done"), tool("failed"), user("faster", true), question(), tool("done"), draft, assistant("ok"), end("failed", 9_000)]))
      .toEqual(["user", "todos", { "Worked for 9.0s": ["work:Ran 2 commands"] }, "tool", "user", "question", "draft", "assistant", "turn_end"]);
  });

  test("the duration falls back to the end row's time when the runner sent none", () => {
    const start = user("go");
    const work = tool("done");
    const stop = { ...end("completed"), createdAt: start.createdAt + 38_000 };
    expect(rowsOf([start, work, assistant("a"), stop])).toEqual(["user", { "Worked for 38s": ["work:Ran 1 command"] }, "assistant"]);
  });

  test("each ask is its own turn", () => {
    expect(rowsOf([user("one"), tool("done"), assistant("a"), end("completed", 2_000), user("two"), tool("running")]))
      .toEqual(["user", { "Worked for 2.0s": ["work:Ran 1 command"] }, "assistant", "user", "work:Ran 1 command"]);
  });
});

describe("step verbs", () => {
  test("the two most telling verbs lead and the rest are counted", () => {
    expect(summarizeSteps(["Bash", "Read", "mcp__comma__read_thread", "Bash", "Read", "Bash", "WebFetch", "Grep", "mcp__comma__get_people"]))
      .toBe("Ran 3 commands, read 2 files, and 4 other actions");
    expect(summarizeSteps(["mcp__comma__read_thread", "Grep", "Edit"])).toBe("Searched code 1 time, changed 1 file, and 1 other action");
    expect(summarizeSteps(["Bash"])).toBe("Ran 1 command");
  });

  test("a trailing complete is dropped from a step's label", () => {
    expect(stepLabel({ kind: "tool", name: "x", summary: "Read the thread completed", status: "done" })).toBe("Read the thread");
    expect(stepLabel({ kind: "tool", name: "WebFetch", summary: "", status: "done" })).toBe("WebFetch");
  });
});

describe("live status", () => {
  test("ticks from the turn's ask and shows the latest thinking's heading or first sentence", () => {
    const ask = user("go");
    const items = [user("old"), end("completed"), ask, thinking("**Checking the list**\nthen more"), tool("running")];
    expect(liveStatus("running", items)).toEqual({ startedAt: ask.createdAt, thought: "Checking the list" });
    expect(liveStatus("running", [ask, thinking("Reading the thread. Then drafting.")])?.thought).toBe("Reading the thread.");
    expect(liveStatus("waiting_input", items)).toBeNull();
    expect(liveStatus("idle", items)).toBeNull();
  });

  test("the timer reads seconds, then minutes with padded seconds", () => {
    expect(formatWorking(5_400)).toBe("5s");
    expect(formatWorking(65_000)).toBe("1m 05s");
    expect(formatWorking(3_725_000)).toBe("1h 2m 5s");
  });
});

describe("step detail", () => {
  test("a command is one line, other input labelled rows, and the output loses an old runner's input prefix", () => {
    expect(stepInput(JSON.stringify({ command: " ls -la ", description: "List files" }))).toEqual({ command: "ls -la", args: null, text: null });
    expect(stepInput(JSON.stringify({ query: "email", limit: 5, clear: "" }))).toEqual({ command: null, args: [["query", "email"], ["limit", "5"], ["clear", "\"\""]], text: null });
    expect(stepInput(undefined)).toBeNull();
    const input = JSON.stringify({ query: "email" });
    expect(stepOutput({ kind: "tool", name: "x", summary: "", status: "done", input, detail: `${input}\n\nfound 2` })).toBe("found 2");
    expect(stepOutput({ kind: "tool", name: "x", summary: "", status: "done", input, detail: "found 2" })).toBe("found 2");
  });
});

describe("prompt history", () => {
  const history = promptHistory([user("first"), assistant("a"), user("second"), user("second"), user("steer", true)]);

  test("collects what the user asked, repeats collapsed", () => {
    expect(history).toEqual(["first", "second", "steer"]);
  });

  test("up walks back from an empty input, down walks forward and then clears", () => {
    const one = stepPromptHistory(history, null, "", "back");
    expect(one).toEqual({ index: 2, text: "steer" });
    const two = stepPromptHistory(history, one!.index, one!.text, "back");
    expect(two).toEqual({ index: 1, text: "second" });
    expect(stepPromptHistory(history, two!.index, two!.text, "forward")).toEqual({ index: 2, text: "steer" });
    expect(stepPromptHistory(history, 2, "steer", "forward")).toEqual({ index: null, text: "" });
    expect(stepPromptHistory(history, 0, "first", "back")).toBeNull();
  });

  test("up leaves typed text alone, including an edited recall", () => {
    expect(stepPromptHistory(history, null, "draft", "back")).toBeNull();
    expect(stepPromptHistory(history, 2, "steer!", "back")).toBeNull();
    expect(stepPromptHistory(history, null, "", "forward")).toBeNull();
  });
});

describe("question answers", () => {
  const single: AgentQuestion = { question: "Which list?", multiSelect: false, options: [{ label: "Freaquency" }, { label: "Afterparty" }] };
  const multi: AgentQuestion = { question: "Who?", multiSelect: true, options: [{ label: "Jesse" }, { label: "Rebecca" }] };

  test("nothing submits until every question has an answer", () => {
    const one = { [single.question]: toggleOption(single, EMPTY_SELECTION, "Freaquency") };
    expect(questionAnswers([single, multi], one)).toBeNull();
    const both = { ...one, [multi.question]: toggleOption(multi, toggleOption(multi, EMPTY_SELECTION, "Jesse"), "Rebecca") };
    expect(questionAnswers([single, multi], both)).toEqual({ "Which list?": "Freaquency", "Who?": "Jesse, Rebecca" });
  });

  test("single select replaces, multi select toggles", () => {
    expect(toggleOption(single, toggleOption(single, EMPTY_SELECTION, "Freaquency"), "Afterparty").labels).toEqual(["Afterparty"]);
    expect(toggleOption(multi, toggleOption(multi, EMPTY_SELECTION, "Jesse"), "Jesse").labels).toEqual([]);
  });

  test("Other needs text, and on a single select it clears the picked option", () => {
    const picked = toggleOption(single, EMPTY_SELECTION, "Freaquency");
    const other = toggleOther(single, picked);
    expect(other.labels).toEqual([]);
    expect(questionAnswers([single], { [single.question]: other })).toBeNull();
    expect(questionAnswers([single], { [single.question]: { ...other, other: "  Kiki 11/7 " } })).toEqual({ "Which list?": "Kiki 11/7" });
  });

  test("digits map to options and stop at the last one", () => {
    expect(questionShortcut("1", 2)).toBe(0);
    expect(questionShortcut("2", 2)).toBe(1);
    expect(questionShortcut("3", 2)).toBeNull();
    expect(questionShortcut("0", 2)).toBeNull();
    expect(questionShortcut("a", 2)).toBeNull();
  });
});
