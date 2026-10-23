/**
 * What an agent chat wants from the user, derived from its stored state. A port of T3 Code's
 * resolveThreadStatusPill and hasUnseenCompletion (apps/web/src/components/Sidebar.logic.ts at
 * 05696c63, MIT) with a settled state added.
 */
export type AgentAttention = "needs_you" | "failed" | "ready" | "working" | "open" | "settled";

export interface AttentionInput {
  state: "idle" | "pending" | "running" | "waiting_input" | "interrupted" | "failed";
  settledAt?: number;
  seenAt?: number;
  lastTurnEndedAt?: number;
  updatedAt: number;
}

export function agentAttention(chat: AttentionInput): AgentAttention {
  if (chat.settledAt !== undefined) return "settled";
  if (chat.state === "waiting_input") return "needs_you";
  if (chat.state === "pending" || chat.state === "running") return "working";
  const unseen = (chat.lastTurnEndedAt ?? 0) > (chat.seenAt ?? 0);
  if (unseen && chat.state === "failed") return "failed";
  if (unseen && chat.state === "idle") return "ready";
  return "open";
}

/** Ready ranks above working, unlike T3: a finished turn is the user's to act on, a running one is not. */
const RANK: Record<Exclude<AgentAttention, "settled">, number> = { needs_you: 0, failed: 1, ready: 2, working: 3, open: 4 };

/** The unsettled chat that most wants the user; ties go to the most recent activity. */
export function mostUrgent<T extends AttentionInput>(chats: readonly T[]): T | undefined {
  let best: { chat: T; rank: number } | undefined;
  for (const chat of chats) {
    const attention = agentAttention(chat);
    if (attention === "settled") continue;
    const rank = RANK[attention];
    if (!best || rank < best.rank || (rank === best.rank && chat.updatedAt > best.chat.updatedAt)) best = { chat, rank };
  }
  return best?.chat;
}

/** The attentions the Agents tab counts. */
export const WANTS_YOU: ReadonlySet<AgentAttention> = new Set<AgentAttention>(["needs_you", "failed", "ready"]);
