import { liveThoughtLine } from "../components/agent/vendor/live-thought-line";
import type { AgentChatState, AgentEntry, AgentItem, AgentQuestion } from "./agent-api";
import { agentModelLabel } from "./agent-models";

type Entry<Kind extends AgentEntry["kind"]> = Extract<AgentEntry, { kind: Kind }>;

export type TranscriptRow =
  | { readonly kind: "item"; readonly key: string; readonly item: AgentItem }
  /** Consecutive steps, summarized as verbs: "Ran 3 commands and read 2 files". */
  | { readonly kind: "work"; readonly key: string; readonly items: readonly AgentItem[]; readonly summary: string; readonly running: boolean }
  /** A finished turn's work, folded behind "Worked for 2m · Luna" or "You stopped after 12s". */
  | { readonly kind: "turn"; readonly key: string; readonly label: string; readonly rows: readonly TranscriptRow[] };

function isStep(item: AgentItem): boolean {
  const entry = item.entry;
  return entry.kind === "thinking" || (entry.kind === "tool" && entry.status !== "failed");
}

type StepAction = "command" | "read" | "edit" | "code-search" | "search" | "other";

const STEP_ACTIONS: Readonly<Record<string, StepAction>> = {
  Bash: "command", Read: "read", Edit: "edit", MultiEdit: "edit", Write: "edit", NotebookEdit: "edit",
  Grep: "code-search", Glob: "code-search", WebSearch: "search", WebFetch: "search",
};

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Ported from T3 Code packages/client-runtime/src/work-log/presentation.ts:549-581 (toolGroupActionLabel).
const ACTION_LABELS: Readonly<Record<StepAction, (n: number) => string>> = {
  command: (n) => `Ran ${count(n, "command")}`,
  read: (n) => `Read ${count(n, "file")}`,
  edit: (n) => `Changed ${count(n, "file")}`,
  "code-search": (n) => `Searched code ${count(n, "time")}`,
  search: (n) => `Searched the web ${count(n, "time")}`,
  other: (n) => `Used ${count(n, "tool")}`,
};

/**
 * T3's summarizeToolGroup (presentation.ts:651-735): the two most telling verbs in first-seen
 * order, commands and edits first and plain tool use last, and a count of the rest.
 */
export function summarizeSteps(names: readonly string[]): string {
  const groups = new Map<StepAction, number>();
  for (const name of names) {
    const action = STEP_ACTIONS[name] ?? "other";
    groups.set(action, (groups.get(action) ?? 0) + 1);
  }
  const priority = (action: StepAction) => action === "command" || action === "edit" ? 0 : action === "other" ? 2 : 1;
  const ranked = [...groups].map(([action, n], index) => ({ action, n, index }));
  const selected = [...ranked].sort((a, b) => priority(a.action) - priority(b.action) || a.index - b.index).slice(0, 2).sort((a, b) => a.index - b.index);
  const labels = selected.map(({ action, n }) => ACTION_LABELS[action](n));
  const rest = names.length - selected.reduce((sum, group) => sum + group.n, 0);
  if (rest > 0) labels.push(count(rest, "other action"));
  const sentence = labels.map((label, index) => index === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1));
  return sentence.length < 3 ? sentence.join(" and ") : `${sentence.slice(0, -1).join(", ")}, and ${sentence.at(-1)}`;
}

/** T3's normalizeCompactToolLabel (presentation.ts:129-131): "Read the thread completed" reads as "Read the thread". */
export function stepLabel(entry: Entry<"tool">): string {
  return (entry.summary || entry.name).replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

/** A run of consecutive steps (and the thinking between them) is one row; thinking alone stays as is. */
function stepRows(items: readonly AgentItem[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let run: AgentItem[] = [];
  const flush = () => {
    const tools = run.flatMap((item) => item.entry.kind === "tool" ? [item.entry] : []);
    if (tools.length === 0) {
      for (const item of run) rows.push({ kind: "item", key: item.key, item });
    } else {
      rows.push({
        kind: "work",
        key: `work-${run[0]!.key}`,
        items: run,
        summary: summarizeSteps(tools.map((tool) => tool.name)),
        running: run.some((item) => (item.entry.kind === "tool" && item.entry.status === "running") || (item.entry.kind === "thinking" && item.entry.streaming)),
      });
    }
    run = [];
  };
  for (const item of items) {
    if (isStep(item)) {
      run.push(item);
      continue;
    }
    flush();
    rows.push({ kind: "item", key: item.key, item });
  }
  flush();
  return rows;
}

/** A turn opens with an ask; a steer sent while it runs belongs to it. */
function turns(items: readonly AgentItem[]): AgentItem[][] {
  const list: AgentItem[][] = [];
  for (const item of items) {
    if ((item.entry.kind === "user" && !item.entry.steer) || list.length === 0) list.push([]);
    list.at(-1)!.push(item);
  }
  return list;
}

/** Ported from T3 Code packages/shared/src/orchestrationTiming.ts:34-52. */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`;
  if (durationMs < 10_000) {
    const tenths = Math.round(durationMs / 100) / 10;
    return tenths >= 10 ? "10s" : `${tenths.toFixed(1)}s`;
  }
  const totalSeconds = Math.round(durationMs / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours > 0 && `${hours}h`, minutes > 0 && `${minutes}m`, seconds > 0 && `${seconds}s`].filter(Boolean).join(" ");
}

/** "You stopped after 12s", for a stopped turn whether or not it has work to fold. */
export function stoppedLabel(durationMs: number | undefined): string {
  return durationMs === undefined ? "You stopped this response" : `You stopped after ${formatDuration(durationMs)}`;
}

/**
 * T3's turn fold (MessagesTimeline.logic.ts:1140-1166): once a turn ends, its steps, thinking and
 * interim replies fold into one row where the first of them stood. The final reply, the user's
 * own messages and answers, drafts, the checklist and failures stay in view.
 */
function foldTurn(turn: readonly AgentItem[]): TranscriptRow[] | null {
  const end = turn.findLast((item): item is AgentItem & { entry: Entry<"turn_end"> } => item.entry.kind === "turn_end");
  if (!end) return null;
  const finalReply = turn.findLast((item) => item.entry.kind === "assistant");
  const folds = (item: AgentItem) => isStep(item) || (item.entry.kind === "assistant" && item !== finalReply);
  const hidden = turn.filter(folds);
  if (hidden.length === 0) return null;
  const elapsed = end.entry.durationMs ?? end.createdAt - turn[0]!.createdAt;
  const outcome = end.entry.outcome === "interrupted" ? stoppedLabel(elapsed) : `Worked for ${formatDuration(elapsed)}`;
  const label = end.entry.model ? `${outcome} · ${agentModelLabel(end.entry.model)}` : outcome;
  const rows: TranscriptRow[] = [];
  for (const item of turn) {
    if (item === hidden[0]) rows.push({ kind: "turn", key: `turn-${item.key}`, label, rows: stepRows(hidden) });
    if (folds(item) || (item === end && end.entry.outcome !== "failed")) continue;
    rows.push({ kind: "item", key: item.key, item });
  }
  return rows;
}

function silent(item: AgentItem): boolean {
  return item.entry.kind === "turn_end" && item.entry.outcome === "completed";
}

export function transcriptRows(items: readonly AgentItem[]): TranscriptRow[] {
  return turns(items).flatMap((turn) => foldTurn(turn) ?? stepRows(turn.filter((item) => !silent(item))));
}

/** Ported from T3 Code apps/mobile/src/features/threads/floating-working-control.tsx:579-596. */
export function formatWorking(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds >= 3_600) return formatDuration(totalSeconds * 1_000);
  return `${Math.floor(totalSeconds / 60)}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
}

export interface LiveStatus {
  /** When the running turn's ask was sent. */
  readonly startedAt: number;
  /** The first sentence or bold heading of the turn's latest thinking, or "". */
  readonly thought: string;
}

/** What the status line under a running turn says. Null while idle or waiting on a question. */
export function liveStatus(state: AgentChatState | undefined, items: readonly AgentItem[]): LiveStatus | null {
  if (state !== "pending" && state !== "running") return null;
  const turn = turns(items).at(-1) ?? [];
  const thinking = turn.findLast((item) => item.entry.kind === "thinking")?.entry as Entry<"thinking"> | undefined;
  return { startedAt: turn[0]?.createdAt ?? Date.now(), thought: thinking ? liveThoughtLine(thinking.text) : "" };
}

export interface StepInput {
  /** A shell command, shown as one line. */
  readonly command: string | null;
  /** Every other input, as labelled rows. */
  readonly args: readonly (readonly [string, string])[] | null;
  /** Input that is not an object. */
  readonly text: string | null;
}

/** T3's toolCallLines (itemDetail.ts:76-110), reading the step's stored JSON input. */
export function stepInput(input: string | undefined): StepInput | null {
  if (!input) return null;
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return { command: null, args: null, text: input };
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.command === "string") return { command: record.command.trim() || null, args: null, text: null };
    const args = Object.entries(record).flatMap(([key, field]): [string, string][] =>
      field === undefined ? [] : [[key, typeof field === "string" && field !== "" ? field : JSON.stringify(field) ?? String(field)]]);
    return args.length > 0 ? { command: null, args, text: null } : null;
  }
  return { command: null, args: null, text: JSON.stringify(value, null, 2) };
}

/** The step's output. A runner from before structured input stored the input JSON ahead of it. */
export function stepOutput(entry: Entry<"tool">): string {
  const detail = entry.detail ?? "";
  if (!entry.input || !detail.startsWith(entry.input)) return detail.trim();
  return detail.slice(entry.input.length).trim();
}

/** Prompt history for the up arrow: what the user asked, oldest first, repeats collapsed. */
export function promptHistory(items: readonly AgentItem[]): string[] {
  const history: string[] = [];
  for (const item of items) {
    if (item.entry.kind !== "user") continue;
    const text = item.entry.text.trim();
    if (text && history.at(-1) !== text) history.push(text);
  }
  return history;
}

export interface HistoryStep { readonly index: number | null; readonly text: string }

/**
 * T3's prompt history rule: up recalls only from an empty input or one still holding a recalled
 * prompt, and down past the newest entry clears the input.
 */
export function stepPromptHistory(history: readonly string[], index: number | null, current: string, direction: "back" | "forward"): HistoryStep | null {
  const active = index !== null && history[index] === current ? index : null;
  if (direction === "back") {
    if (active === null && current !== "") return null;
    const next = active === null ? history.length - 1 : active - 1;
    return next >= 0 ? { index: next, text: history[next]! } : null;
  }
  if (active === null) return null;
  const next = active + 1;
  return next < history.length ? { index: next, text: history[next]! } : { index: null, text: "" };
}

export function agentIsRunning(state: AgentChatState | undefined): boolean {
  return state === "pending" || state === "running" || state === "waiting_input";
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
