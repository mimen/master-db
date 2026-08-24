import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AiStatus } from "@shared/types";

/** Server-reported AI capability, shared by web, narrow layouts, and Expo Go. */
export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    let active = true;
    api
      .aiStatus()
      .then((next) => active && setStatus(next))
      .catch(() => active && setStatus({
        suggestions: false,
        reactionSuggestions: false,
        shadow: false,
        shadowDetail: "unreachable",
      }));
    return () => {
      active = false;
    };
  }, []);
  return status;
}
