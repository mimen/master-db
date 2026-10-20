import { describe, expect, test } from "bun:test";
import type { AgentChat, AgentEntry, AgentItem, AgentQuestion } from "./agent-api";
import {
  agentStripState,
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
const tool = (status: "running" | "done" | "failed", at?: number, updatedAt?: number) =>
  item({ kind: "tool", name: "Bash", summary: "ran a command", status }, at, updatedAt);
const user = (text: string) => item({ kind: "user", text, steer: false });
const assistant = (text: string) => item({ kind: "assistant", text, streaming: false });
const question = () => item({ kind: "question", requestId: "q", status: "pending", questions: [] });

function shape(items: AgentItem[]) {
  return transcriptRows(items).map((row) => row.kind === "work" ? `work:${row.steps}` : row.item.entry.kind);
}

describe("work log", () => {
  test("consecutive steps and the thinking between them fold into one row", () => {
    expect(shape([user("go"), tool("done"), item({ kind: "thinking", text: "hm", streaming: false }), tool("done"), tool("done"), assistant("done")]))
      .toEqual(["user", "work:3", "assistant"]);
  });

  test("a failed step and a question break the run and stay visible", () => {
    expect(shape([tool("done"), tool("failed"), tool("done"), question(), tool("done")]))
      .toEqual(["work:1", "tool", "work:1", "question", "work:1"]);
  });

  test("thinking without a step is not a work row", () => {
    expect(shape([user("hi"), item({ kind: "thinking", text: "hm", streaming: false }), assistant("hello")]))
      .toEqual(["user", "thinking", "assistant"]);
  });

  test("the row reports elapsed time from the first step to the last update, and whether one still runs", () => {
    const [row] = transcriptRows([tool("done", 10_000, 12_000), tool("running", 30_000, 48_000)]);
    expect(row).toMatchObject({ kind: "work", steps: 2, seconds: 38, running: true });
  });

  test("a completed turn end is silent, a stopped or failed one is shown", () => {
    expect(shape([assistant("a"), item({ kind: "turn_end", outcome: "completed" }),
      item({ kind: "turn_end", outcome: "interrupted" }), item({ kind: "turn_end", outcome: "failed", error: "boom" })]))
      .toEqual(["assistant", "turn_end", "turn_end"]);
  });
});

describe("state strip", () => {
  const chat = (state: AgentChat["state"]) => ({ state } as AgentChat);
  const draft = (used: boolean) => item({ kind: "draft", text: "hey", placed: "pane", used });

  test("asking beats working, and nothing shows for an idle chat with no draft", () => {
    expect(agentStripState(chat("waiting_input"), [])).toBe("asking");
    expect(agentStripState(chat("running"), [])).toBe("working");
    expect(agentStripState(chat("pending"), [])).toBe("working");
    expect(agentStripState(chat("idle"), [user("hi"), assistant("hello")])).toBeNull();
    expect(agentStripState(null, [draft(false)])).toBeNull();
  });

  test("only an unused draft from the latest turn counts", () => {
    expect(agentStripState(chat("idle"), [user("draft it"), draft(false)])).toBe("drafted");
    expect(agentStripState(chat("idle"), [user("draft it"), draft(true)])).toBeNull();
    expect(agentStripState(chat("idle"), [user("draft it"), draft(false), user("thanks"), assistant("np")])).toBeNull();
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
