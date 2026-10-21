import type { api } from "@convex-api";
import { anyApi, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import type { GenericId } from "convex/values";
import type {
  AgentChatDoc,
  AgentEffort,
  AgentEntry as SchemaAgentEntry,
  AgentItemDoc,
} from "../../../../../convex/schema/comma/validators";

export type { AgentChatState, AgentEffort, AgentQuestion } from "../../../../../convex/schema/comma/validators";

// ponytail: batch 2's additive fields, written by hand until feat/comma-agent-batch2-runner lands the
// validators; then every type below derives from the schema again and only this module changes.
export interface AgentAttachment {
  readonly storageId: GenericId<"_storage">;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
}
export type AgentAttachmentMeta = Omit<AgentAttachment, "storageId">;
export type AgentTodoStatus = "pending" | "in_progress" | "completed";
export interface AgentTodo { readonly content: string; readonly activeForm?: string; readonly status: AgentTodoStatus }

type SchemaEntry<Kind extends SchemaAgentEntry["kind"]> = Extract<SchemaAgentEntry, { kind: Kind }>;
export type AgentEntry =
  | Exclude<SchemaAgentEntry, { kind: "user" | "tool" | "turn_end" }>
  | SchemaEntry<"user"> & { attachments?: AgentAttachmentMeta[] }
  | SchemaEntry<"tool"> & { input?: string; startedAt?: number; endedAt?: number }
  | SchemaEntry<"turn_end"> & { model?: string; effort?: AgentEffort }
  | { kind: "todos"; todos: AgentTodo[] };

export type AgentChat = AgentChatDoc;
export type AgentItem = Omit<AgentItemDoc, "entry"> & { entry: AgentEntry };
export type AgentChatId = AgentChat["_id"];
export type AgentItemId = AgentItem["_id"];

type SchemaAgentApi = typeof api.comma.agent;
export type AskArgs = FunctionArgs<SchemaAgentApi["ask"]> & { attachments?: AgentAttachment[] };
export const agentApi = anyApi.comma.agent as unknown as Omit<SchemaAgentApi, "ask" | "listItems"> & {
  ask: FunctionReference<"mutation", "public", AskArgs, FunctionReturnType<SchemaAgentApi["ask"]>>;
  listItems: FunctionReference<"query", "public", FunctionArgs<SchemaAgentApi["listItems"]>, AgentItem[]>;
};

/** The runner beats every 30 s; two minutes of silence means it is gone. */
export const AGENT_FRESH_MS = 120_000;

export function agentAvailable(heartbeatAt: number | null | undefined, now: number): boolean {
  return heartbeatAt != null && now - heartbeatAt <= AGENT_FRESH_MS;
}

export function agentItemKey(): string {
  return `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
