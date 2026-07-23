import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { api } from "@/lib/api";
import type { AiStatus } from "@shared/types";

/**
 * Server-reported AI availability. `null` while loading; both flags false when
 * the gateway key is absent, so surfaces can hide rather than error. Fetched
 * once — availability is a server-config fact, not per-request state.
 *
 * AI features are desktop-web only for phase 1: the surfaces assume a wide
 * split-pane layout and a keyboard, and the shadow lane runs against the Mini.
 */
export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const { wide } = useLayoutMode();
  const isDesktop = Platform.OS === "web" && wide;
  useEffect(() => {
    if (!isDesktop) return;
    let active = true;
    api
      .aiStatus()
      .then((s) => active && setStatus(s))
      .catch(() => active && setStatus({ suggestions: false, shadow: false, shadowDetail: "unreachable" }));
    return () => {
      active = false;
    };
  }, [isDesktop]);
  return status;
}
