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

/** The runner beats every 30 s; two minutes of silence means it is gone. */
export const AGENT_FRESH_MS = 120_000;

export function agentAvailable(heartbeatAt: number | null | undefined, now: number): boolean {
  return heartbeatAt != null && now - heartbeatAt <= AGENT_FRESH_MS;
}

export function agentItemKey(): string {
  return `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
