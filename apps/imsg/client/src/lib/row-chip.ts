import type { ChatSummary } from "@shared/types";

import { AGENT_ATTENTION } from "@/lib/inbox-model";
import { shortDay } from "@/lib/later-times";
import { formatScheduledWhen } from "@/lib/scheduled";

export type RowChipTone = "turn" | "destructive" | "accent" | "neutral";

/** The one chip a conversation row's preview line may carry: what its agent wants, else where Later left it. */
export interface RowChip {
  readonly label: string;
  readonly tone: RowChipTone;
  readonly icon: "sparkles" | "time-outline" | "alarm-outline" | "return-down-back-outline";
}

const AGENT_TONE: Record<NonNullable<ChatSummary["agent"]>["attention"], RowChipTone | null> = {
  needs_you: "turn",
  failed: "destructive",
  ready: "accent",
  working: "neutral",
  // An open chat with nothing to say adds nothing to the row.
  open: null,
};

export function rowChip(chat: Pick<ChatSummary, "agent" | "later">, { agentLens = false, now = new Date() } = {}): RowChip | null {
  const agent = chat.agent;
  const tone = agent && !agentLens ? AGENT_TONE[agent.attention] : null;
  if (agent && tone) return { label: `Agent: ${AGENT_ATTENTION[agent.attention].header.toLowerCase()}`, tone, icon: "sparkles" };
  const later = chat.later;
  if (later?.returned) return { label: later.returned.reason === "message" ? "Back: new reply" : "Back from Later", tone: "neutral", icon: "return-down-back-outline" };
  if (later?.followUp?.due) return { label: `No reply since ${shortDay(later.followUp.since)}`, tone: "neutral", icon: "alarm-outline" };
  if (later?.snoozedUntil !== undefined) return { label: `Snoozed until ${formatScheduledWhen(later.snoozedUntil, now)}`, tone: "neutral", icon: "time-outline" };
  return null;
}
