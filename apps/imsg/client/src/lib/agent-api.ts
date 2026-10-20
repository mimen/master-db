import type { api } from "@convex-api";
import { anyApi, type FunctionArgs } from "convex/server";
import type { AgentChatDoc, AgentItemDoc } from "../../../../../convex/schema/comma/validators";

export type { AgentChatState, AgentEffort, AgentEntry, AgentQuestion } from "../../../../../convex/schema/comma/validators";
export type AgentChat = AgentChatDoc;
export type AgentItem = AgentItemDoc;
export type AgentChatId = AgentChat["_id"];
export type AgentItemId = AgentItem["_id"];

export const agentApi = anyApi.comma.agent as unknown as typeof api.comma.agent;
export type AskArgs = FunctionArgs<typeof agentApi.ask>;

export function agentItemKey(): string {
  return `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
