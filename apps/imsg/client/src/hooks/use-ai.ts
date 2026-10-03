import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AiStatus } from "@shared/types";

const UNREACHABLE: AiStatus = {
  suggestions: false,
  reactionSuggestions: false,
};

// Capability is fixed for the server's lifetime; fetch it once per app session,
// not once per opened chat. A failure is not cached, so the next mount retries.
let known: AiStatus | null = null;
let pending: Promise<AiStatus> | null = null;

/** Server-reported AI capability, shared by web, narrow layouts, and Expo Go. */
export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(known);
  useEffect(() => {
    if (known) return;
    let active = true;
    pending ??= api
      .aiStatus()
      .then((next) => (known = next))
      .finally(() => (pending = null));
    pending
      .then((next) => active && setStatus(next))
      .catch(() => active && setStatus(UNREACHABLE));
    return () => {
      active = false;
    };
  }, []);
  return status;
}
