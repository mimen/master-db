import type { AgentChatState, AgentEntry, AgentPreview } from "../schema/comma/validators";

const TITLE_CHARS = 48;
const PREVIEW_CHARS = 200;

function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The title a chat shows until the runner names it: its first ask on one line. */
export function askTitle(firstAsk: string): string {
  return cap(firstAsk.replace(/\s+/g, " ").trim(), TITLE_CHARS) || "Agent chat";
}

type Entry<K extends AgentEntry["kind"]> = Extract<AgentEntry, { kind: K }>;

function newest<K extends AgentEntry["kind"]>(entries: readonly AgentEntry[], ...kinds: K[]): Entry<K> | undefined {
  return entries.find((entry): entry is Entry<K> => (kinds as string[]).includes(entry.kind));
}

function preview(kind: AgentPreview["kind"], text: string | undefined): AgentPreview | undefined {
  const trimmed = text?.trim();
  return trimmed ? { kind, text: cap(trimmed, PREVIEW_CHARS) } : undefined;
}

/**
 * The line a chat shows in lists, from its newest items first. The current turn is everything
 * after the newest user entry, so an earlier turn's draft or thought never stands for this one.
 */
export function chatPreview(newestFirst: readonly AgentEntry[], state: AgentChatState): AgentPreview | undefined {
  if (state === "waiting_input") {
    const question = newestFirst.find((entry): entry is Entry<"question"> => entry.kind === "question" && entry.status === "pending");
    const asked = preview("question", question?.questions[0]?.question);
    if (asked) return asked;
  }
  if (state === "failed") {
    const failed = preview("error", newest(newestFirst, "turn_end")?.error);
    if (failed) return failed;
  }
  const ask = newestFirst.findIndex((entry) => entry.kind === "user");
  const turn = ask < 0 ? newestFirst : newestFirst.slice(0, ask);
  if (state === "pending" || state === "running") return preview("thinking", newest(turn, "thinking", "assistant")?.text);
  return preview("draft", newest(turn, "draft")?.text) ?? preview("reply", newest(newestFirst, "assistant")?.text);
}
