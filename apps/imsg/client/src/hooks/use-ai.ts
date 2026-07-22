import { useEffect, useState } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { api } from "@/lib/api";
import type { AiStatus } from "@shared/types";

/**
 * AI features are desktop-web only for phase 1: the surfaces assume a wide
 * split-pane layout and a keyboard, and the shadow lane runs against the Mini.
 */
export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === "web" && width >= 768;
}

/**
 * Server-reported AI availability. `null` while loading; both flags false when
 * the gateway key is absent, so surfaces can hide rather than error. Fetched
 * once — availability is a server-config fact, not per-request state.
 */
export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const isDesktop = useIsDesktop();
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
