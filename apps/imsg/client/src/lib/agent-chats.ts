import { agentAttention, type AgentAttention } from "@shared/agent-attention";

import type { AgentChatId, AgentChatSummary } from "./agent-api";
import { formatWorking } from "./agent-transcript";
import { formatReceiptTime } from "./format";

/** What the agent pane shows: one of the conversation's chats, or an empty one its first ask creates. */
export type PaneSelection = { readonly kind: "chat"; readonly chatId: AgentChatId } | { readonly kind: "new" };

export type SwitcherValue = AgentChatId | "new";

export interface SwitcherRow {
  readonly value: SwitcherValue;
  readonly label: string;
  /** The state word, a working chat's elapsed time, or a settled chat's date. */
  readonly trailing?: string;
  readonly section: string;
  /** Absent for New chat. */
  readonly attention?: AgentAttention;
}

function stateWord(chat: AgentChatSummary, attention: AgentAttention, now: number): string {
  switch (attention) {
    case "needs_you": return "Needs you";
    case "failed": return "Failed";
    case "ready": return chat.preview?.kind === "draft" ? "Draft ready" : "Ready";
    // The runner patches the chat as its turn starts, so the last update is about when the work began.
    case "working": return formatWorking(now - chat.updatedAt);
    case "open": return "Open";
    case "settled": return formatReceiptTime(chat.settledAt ?? chat.updatedAt, now);
  }
}

/**
 * The switcher's menu: the open chats under the person's name, then the settled ones, then New
 * chat. A chat the pane just created reads "New chat" until the list carries it.
 */
export function switcherRows(chats: readonly AgentChatSummary[], name: string, selected: PaneSelection, now: number): SwitcherRow[] {
  const rows: SwitcherRow[] = chats.map((chat) => {
    const attention = agentAttention(chat);
    return { value: chat._id, label: chat.title, trailing: stateWord(chat, attention, now), attention, section: attention === "settled" ? "Settled" : name };
  });
  if (selected.kind === "chat" && !chats.some((chat) => chat._id === selected.chatId)) {
    rows.unshift({ value: selected.chatId, label: "New chat", attention: "working", section: name });
  }
  return [
    ...rows.filter((row) => row.attention !== "settled"),
    ...rows.filter((row) => row.attention === "settled"),
    { value: "new", label: "New chat", section: "" },
  ];
}
