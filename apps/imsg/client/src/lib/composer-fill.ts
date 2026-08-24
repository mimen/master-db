import type { ReplySuggestion, SuggestionModel } from "@shared/types";

export interface SuggestionAttribution {
  suggestion: ReplySuggestion;
  selectedModel: SuggestionModel;
  servedModel: SuggestionModel;
  recipeVersion: number;
  selectedAt: number;
}

export interface ComposerFill {
  text: string;
  attribution: SuggestionAttribution | null;
}

type Listener = (fill: ComposerFill) => void;
const listeners: Listener[] = [];

/** Fill the active composer. Supplying attribution enables local edit learning. */
export function fillComposer(text: string, attribution: SuggestionAttribution | null = null): void {
  listeners[listeners.length - 1]?.({ text, attribution });
}

export function onFillComposer(cb: Listener): () => void {
  listeners.push(cb);
  return () => {
    const index = listeners.lastIndexOf(cb);
    if (index >= 0) listeners.splice(index, 1);
  };
}
