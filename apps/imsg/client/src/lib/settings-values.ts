import type { SuggestionModel } from "@shared/types";

export type SuggestionMode = "off" | "on-demand" | "auto";

/** How the Contacts list orders and labels a person's name. "first-last" is
 * the default — today's untouched behavior ("First Last", sorted by first
 * name's section letter). "last-first" sorts/labels by last name instead
 * ("Last, First") — see lib/contact-order.ts for the pure derivation. */
export type NameOrder = "first-last" | "last-first";

export interface Settings {
  /** How reply suggestions appear: never, on a tap, or automatically on open. */
  suggestionMode: SuggestionMode;
  /** Preferred reply-suggestion model; server may fall back when this route fails. */
  suggestionModel: SuggestionModel;
  /** Contacts list name ordering — see NameOrder above. */
  nameOrder: NameOrder;
}

export const DEFAULT: Settings = { suggestionMode: "auto", suggestionModel: "opus", nameOrder: "first-last" };

function isMode(value: unknown): value is SuggestionMode {
  return value === "off" || value === "on-demand" || value === "auto";
}

function isSuggestionModel(value: unknown): value is SuggestionModel {
  return value === "opus" || value === "terra";
}

function isNameOrder(value: unknown): value is NameOrder {
  return value === "first-last" || value === "last-first";
}

export function parseSettings(raw: string): Settings {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") return { ...DEFAULT };
  const parsed = value as Partial<Settings>;
  return {
    suggestionMode: isMode(parsed.suggestionMode) ? parsed.suggestionMode : DEFAULT.suggestionMode,
    suggestionModel: isSuggestionModel(parsed.suggestionModel) ? parsed.suggestionModel : DEFAULT.suggestionModel,
    nameOrder: isNameOrder(parsed.nameOrder) ? parsed.nameOrder : DEFAULT.nameOrder,
  };
}
