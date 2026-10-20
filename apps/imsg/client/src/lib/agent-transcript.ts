import type { AgentChat, AgentChatState, AgentItem, AgentQuestion } from "./agent-api";

export type TranscriptRow =
  | { readonly kind: "item"; readonly key: string; readonly item: AgentItem }
  | { readonly kind: "work"; readonly key: string; readonly items: readonly AgentItem[]; readonly steps: number; readonly running: boolean; readonly seconds: number };

function foldable(item: AgentItem): boolean {
  const entry = item.entry;
  return entry.kind === "thinking" || (entry.kind === "tool" && entry.status !== "failed");
}

function hidden(item: AgentItem): boolean {
  return item.entry.kind === "turn_end" && item.entry.outcome === "completed";
}

/**
 * T3's work-log rule: a run of consecutive tool steps (and the thinking between them) reads as one
 * "Worked for 38s · 5 steps" row. A failed step, a question, or any message ends the run, so errors
 * and questions are never folded away. A run with no tool in it is just thinking and stays as is.
 */
export function transcriptRows(items: readonly AgentItem[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let run: AgentItem[] = [];
  const flush = () => {
    const tools = run.filter((item) => item.entry.kind === "tool");
    if (tools.length === 0) {
      for (const item of run) rows.push({ kind: "item", key: item.key, item });
    } else {
      const first = run[0]!;
      const last = run.at(-1)!;
      rows.push({
        kind: "work",
        key: `work-${first.key}`,
        items: run,
        steps: tools.length,
        running: run.some((item) => (item.entry.kind === "tool" && item.entry.status === "running") || (item.entry.kind === "thinking" && item.entry.streaming)),
        seconds: Math.max(0, Math.round((last.updatedAt - first.createdAt) / 1000)),
      });
    }
    run = [];
  };
  for (const item of items) {
    if (hidden(item)) continue;
    if (foldable(item)) {
      run.push(item);
      continue;
    }
    flush();
    rows.push({ kind: "item", key: item.key, item });
  }
  flush();
  return rows;
}

export function agentIsRunning(state: AgentChatState | undefined): boolean {
  return state === "pending" || state === "running" || state === "waiting_input";
}

export type AgentStripState = "asking" | "working" | "drafted";

/** What the state strip says about the agent while its pane is closed. Only the latest turn counts. */
export function agentStripState(chat: AgentChat | null | undefined, items: readonly AgentItem[]): AgentStripState | null {
  if (!chat) return null;
  if (chat.state === "waiting_input") return "asking";
  if (chat.state === "running" || chat.state === "pending") return "working";
  const lastAsk = items.findLastIndex((item) => item.entry.kind === "user");
  const drafted = items.slice(lastAsk + 1).some((item) => item.entry.kind === "draft" && !item.entry.used);
  return drafted ? "drafted" : null;
}

export interface QuestionSelection {
  readonly labels: readonly string[];
  readonly other: string;
  readonly useOther: boolean;
}

export const EMPTY_SELECTION: QuestionSelection = { labels: [], other: "", useOther: false };

export function toggleOption(question: AgentQuestion, current: QuestionSelection, label: string): QuestionSelection {
  if (!question.multiSelect) return { labels: [label], other: "", useOther: false };
  const labels = current.labels.includes(label) ? current.labels.filter((value) => value !== label) : [...current.labels, label];
  return { ...current, labels };
}

export function toggleOther(question: AgentQuestion, current: QuestionSelection): QuestionSelection {
  return { labels: question.multiSelect ? current.labels : [], other: current.other, useOther: !current.useOther };
}

export function questionAnswer(selection: QuestionSelection | undefined): string | null {
  if (!selection) return null;
  const other = selection.other.trim();
  if (selection.useOther && !other) return null;
  const values = [...selection.labels, ...(selection.useOther ? [other] : [])];
  return values.length > 0 ? values.join(", ") : null;
}

/** AskUserQuestion's answer shape: question text to the chosen label(s). Null until every question has one. */
export function questionAnswers(questions: readonly AgentQuestion[], selections: Readonly<Record<string, QuestionSelection>>): Record<string, string> | null {
  const answers: Record<string, string> = {};
  for (const question of questions) {
    const answer = questionAnswer(selections[question.question]);
    if (answer === null) return null;
    answers[question.question] = answer;
  }
  return answers;
}

/** Digit 1-9 picks that option; anything else, or a digit past the last option, is not a shortcut. */
export function questionShortcut(key: string, optionCount: number): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  const index = Number(key) - 1;
  return index < optionCount ? index : null;
}
