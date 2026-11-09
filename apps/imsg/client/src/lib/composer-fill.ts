import type { ConversationId, ReplySuggestion, SuggestionModel } from "@shared/types";

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
const listeners: { conversationId: ConversationId; listener: Listener }[] = [];

/**
 * Fill the composer of `conversationId`: a Slack thread open beside its channel mounts two. Supplying attribution
 * enables local edit learning.
 */
export function fillComposer(conversationId: ConversationId, text: string, attribution: SuggestionAttribution | null = null): void {
  listeners.findLast((entry) => entry.conversationId === conversationId)?.listener({ text, attribution });
}

export function onFillComposer(conversationId: ConversationId, listener: Listener): () => void {
  const entry = { conversationId, listener };
  listeners.push(entry);
  return () => {
    const index = listeners.lastIndexOf(entry);
    if (index >= 0) listeners.splice(index, 1);
  };
}
