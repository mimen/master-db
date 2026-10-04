import { useQuery } from "convex/react";
import { aiApi } from "@/lib/ai-api";
import type { AiStatus } from "@shared/types";

const UNREACHABLE: AiStatus = {
  suggestions: false,
  reactionSuggestions: false,
};

/** Mini capability published by the presence bridge. */
export function useAiStatus(): AiStatus | null {
  return useQuery(aiApi.aiStatus, {}) ?? UNREACHABLE;
}
