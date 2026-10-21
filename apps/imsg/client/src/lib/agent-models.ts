import type { AgentEffort } from "./agent-api";

/**
 * The agent pane's models, in picker order. Ids and default efforts are the rows of the same id in
 * ClaudeConfig/models.toml; every row there takes all five efforts. Sonnet 5.5's row names no
 * default, so it starts at Claude Code's own, high.
 */
export const AGENT_MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5", effort: "medium" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", effort: "high" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", effort: "medium" },
  { id: "gpt-6.1-sol", label: "Sol", effort: "medium" },
  { id: "muse-wonder-full-1.0", label: "Muse Wonder Full", effort: "high" },
  { id: "gpt-6-luna", label: "Luna", effort: "low" },
] as const satisfies readonly { id: string; label: string; effort: AgentEffort }[];
export type AgentModel = (typeof AGENT_MODELS)[number]["id"];

export const AGENT_EFFORTS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
  { id: "max", label: "Max" },
] as const satisfies readonly { id: AgentEffort; label: string }[];

export interface AgentModelChoice { readonly model: AgentModel; readonly effort: AgentEffort }
export const DEFAULT_AGENT_CHOICE: AgentModelChoice = { model: "claude-opus-5-5", effort: "high" };

export function isAgentModel(value: unknown): value is AgentModel {
  return AGENT_MODELS.some((model) => model.id === value);
}

export function isAgentEffort(value: unknown): value is AgentEffort {
  return AGENT_EFFORTS.some((effort) => effort.id === value);
}

/** A model no longer offered (Fable 5.1, say) falls back to the default pair. */
export function agentModelChoice(model: unknown, effort: unknown): AgentModelChoice {
  if (!isAgentModel(model)) return DEFAULT_AGENT_CHOICE;
  return { model, effort: isAgentEffort(effort) ? effort : DEFAULT_AGENT_CHOICE.effort };
}

/** Switching model starts it at its own default effort, as T3's traits picker does. */
export function withModel(model: AgentModel): AgentModelChoice {
  return { model, effort: AGENT_MODELS.find((row) => row.id === model)!.effort };
}

export function agentModelLabel(model: string): string {
  return AGENT_MODELS.find((row) => row.id === model)?.label ?? model;
}
