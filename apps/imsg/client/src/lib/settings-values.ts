import type { StateFilter, SuggestionModel } from "@shared/types";
import type { AgentEffort } from "./agent-api";

export type SuggestionMode = "off" | "on-demand" | "auto";

/** How the Contacts list orders and labels a person's name. "first-last" is
 * the default — today's untouched behavior ("First Last", sorted by first
 * name's section letter). "last-first" sorts/labels by last name instead
 * ("Last, First") — see lib/contact-order.ts for the pure derivation. */
export type NameOrder = "first-last" | "last-first";

/** "system" follows the OS appearance; the others pin it. */
export type ThemePreference = "system" | "light" | "dark";

/** The lens Comma starts in. Settled is a filter, not a lens, so it is not offered. */
export type OpenOnLens = Exclude<StateFilter, "settled">;

/** How every lens sections its conversations. */
export type GroupConversationsBy = "last-message" | "person" | "none";

export const AGENT_MODELS = ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5"] as const;
export type AgentModel = (typeof AGENT_MODELS)[number];
export const AGENT_EFFORTS: readonly AgentEffort[] = ["low", "medium", "high", "xhigh", "max"];

export interface Settings {
  /** How reply suggestions appear: never, on a tap, or automatically on open. */
  suggestionMode: SuggestionMode;
  /** Preferred reply-suggestion model; server may fall back when this route fails. */
  suggestionModel: SuggestionModel;
  /** Contacts list name ordering — see NameOrder above. */
  nameOrder: NameOrder;
  theme: ThemePreference;
  openOn: OpenOnLens;
  groupBy: GroupConversationsBy;
  /** The Agent tab in the utility pane, and ⌘J. Shown only while the Mini's agent runner is up. */
  agentPane: boolean;
  /** Fixed into a chat when it starts; a change applies to the next chat. */
  agentModel: AgentModel;
  agentEffort: AgentEffort;
}

export const DEFAULT: Settings = {
  suggestionMode: "auto",
  suggestionModel: "opus",
  nameOrder: "first-last",
  theme: "system",
  openOn: "unresponded",
  groupBy: "last-message",
  agentPane: true,
  agentModel: "claude-opus-5-5",
  agentEffort: "high",
};

function isMode(value: unknown): value is SuggestionMode {
  return value === "off" || value === "on-demand" || value === "auto";
}

function isSuggestionModel(value: unknown): value is SuggestionModel {
  return value === "opus" || value === "terra";
}

function isNameOrder(value: unknown): value is NameOrder {
  return value === "first-last" || value === "last-first";
}

function isTheme(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function isOpenOn(value: unknown): value is OpenOnLens {
  return value === "unresponded" || value === "unread" || value === "waiting" || value === "all";
}

function isGroupBy(value: unknown): value is GroupConversationsBy {
  return value === "last-message" || value === "person" || value === "none";
}

function isAgentModel(value: unknown): value is AgentModel {
  return AGENT_MODELS.includes(value as AgentModel);
}

function isAgentEffort(value: unknown): value is AgentEffort {
  return AGENT_EFFORTS.includes(value as AgentEffort);
}

export function parseSettings(raw: string): Settings {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") return { ...DEFAULT };
  const parsed = value as Partial<Settings>;
  return {
    suggestionMode: isMode(parsed.suggestionMode) ? parsed.suggestionMode : DEFAULT.suggestionMode,
    suggestionModel: isSuggestionModel(parsed.suggestionModel) ? parsed.suggestionModel : DEFAULT.suggestionModel,
    nameOrder: isNameOrder(parsed.nameOrder) ? parsed.nameOrder : DEFAULT.nameOrder,
    theme: isTheme(parsed.theme) ? parsed.theme : DEFAULT.theme,
    openOn: isOpenOn(parsed.openOn) ? parsed.openOn : DEFAULT.openOn,
    groupBy: isGroupBy(parsed.groupBy) ? parsed.groupBy : DEFAULT.groupBy,
    agentPane: typeof parsed.agentPane === "boolean" ? parsed.agentPane : DEFAULT.agentPane,
    agentModel: isAgentModel(parsed.agentModel) ? parsed.agentModel : DEFAULT.agentModel,
    agentEffort: isAgentEffort(parsed.agentEffort) ? parsed.agentEffort : DEFAULT.agentEffort,
  };
}
