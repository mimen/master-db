import { notImplemented, type HandlerMap } from "./types";
export const aiHandlers = {
  suggestions: notImplemented<"suggestions">(true),
  identify: notImplemented<"identify">(true),
  suggestionFeedback: notImplemented<"suggestionFeedback">(),
  clearSuggestionLearning: notImplemented<"clearSuggestionLearning">(),
} satisfies Partial<HandlerMap>;
