import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import type { draftAttachment } from "../../../../../convex/schema/comma/validators";

// Hand-written from the agent contract until convex/comma/agent.ts lands; then these become
// Infer<> of its validators and the references come from the generated api, as in convex-api.ts.
export type AgentEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type AgentChatState = "idle" | "pending" | "running" | "waiting_input" | "interrupted" | "failed";

export interface AgentQuestion {
  readonly question: string;
  readonly header?: string;
  readonly multiSelect: boolean;
  readonly options: readonly { readonly label: string; readonly description?: string }[];
}

export type AgentEntry =
  | { kind: "user"; text: string; steer: boolean }
  | { kind: "assistant"; text: string; streaming: boolean }
  | { kind: "thinking"; text: string; streaming: boolean }
  | { kind: "tool"; name: string; summary: string; detail?: string; status: "running" | "done" | "failed" }
  | { kind: "question"; requestId: string; questions: AgentQuestion[]; status: "pending" | "resolved" | "cancelled"; answers?: Record<string, string> }
  | { kind: "draft"; text: string; note?: string; attachments?: (typeof draftAttachment)["type"][]; placed: "composer" | "pane"; used: boolean }
  | { kind: "turn_end"; outcome: "completed" | "interrupted" | "failed"; error?: string; durationMs?: number };

export type AgentChatId = GenericId<"comma_agent_chats">;
export type AgentItemId = GenericId<"comma_agent_items">;
type ConversationId = GenericId<"comma_conversations">;

export interface AgentItem {
  readonly _id: AgentItemId;
  readonly _creationTime: number;
  readonly chatId: AgentChatId;
  readonly key: string;
  readonly ordinal: number;
  readonly entry: AgentEntry;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AgentChat {
  readonly _id: AgentChatId;
  readonly _creationTime: number;
  readonly conversationId: ConversationId;
  readonly sessionId?: string;
  readonly state: AgentChatState;
  readonly model: string;
  readonly effort: AgentEffort;
  readonly seenThroughMessageAt?: number;
  readonly archivedAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type AskArgs = {
  conversationId: ConversationId;
  key: string;
  text: string;
  steer: boolean;
  model: string;
  effort: AgentEffort;
};

export const agentApi = {
  liveChat: makeFunctionReference<"query", { conversationId: ConversationId }, AgentChat | null>("comma/agent:liveChat"),
  listItems: makeFunctionReference<"query", { chatId: AgentChatId }, AgentItem[]>("comma/agent:listItems"),
  ask: makeFunctionReference<"mutation", AskArgs, AgentChatId>("comma/agent:ask"),
  answer: makeFunctionReference<"mutation", { chatId: AgentChatId; requestId: string; answers: Record<string, string> }, null>("comma/agent:answer"),
  stop: makeFunctionReference<"mutation", { chatId: AgentChatId }, null>("comma/agent:stop"),
  newChat: makeFunctionReference<"mutation", { conversationId: ConversationId }, null>("comma/agent:newChat"),
  useDraft: makeFunctionReference<"mutation", { itemId: AgentItemId }, null>("comma/agent:useDraft"),
};

export function agentItemKey(): string {
  return `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
