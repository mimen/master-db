import type { AgentEffort } from "./convex-port";

/** The pane's models, ids from ClaudeConfig/models.toml. Every one is proven on the Mini's gateway. */
export const AGENT_MODELS = [
  "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "gpt-6.1-sol", "muse-wonder-full-1.0", "gpt-6-luna",
] as const;

export type Selection = { model: string; effort: AgentEffort };

export const DEFAULT_SELECTION: Selection = { model: "claude-opus-5-5", effort: "high" };

/** A model that left the list, such as a saved Fable 5.1, runs as the default selection. */
export function resolveSelection(model: string, effort: AgentEffort): Selection {
  return (AGENT_MODELS as readonly string[]).includes(model) ? { model, effort } : DEFAULT_SELECTION;
}

export const sameSelection = (a: Selection, b: Selection) => a.model === b.model && a.effort === b.effort;

/** claudex's spelling: a Claude id carries the [1m] marker so Claude Code accounts its 1M window. */
export const sdkModel = (model: string) => model.startsWith("claude-") ? `${model}[1m]` : model;
