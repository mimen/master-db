import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { useAgentEnabled } from "@/hooks/use-agent";
import { useAiStatus } from "@/hooks/use-ai";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { AgentPane } from "@/components/lazy-surfaces";

const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

/** The phone's Agent tab. Wide screens open the same pane in the shell's utility surface. */
export default function AgentScreen(): React.JSX.Element | null {
  const { guid, chat } = useLocalSearchParams<{ guid: string; chat?: string }>();
  const { wide } = useLayoutMode();
  const enabled = useAgentEnabled();
  const { loaded } = useAiStatus();
  // A runner that goes stale, or the setting turning off, dismisses the tab. A cold load waits for the first status.
  useEffect(() => {
    if (!wide && loaded && !enabled) close();
  }, [wide, loaded, enabled]);
  if (wide || !guid || !enabled) return null;
  return <AgentPane chatGuid={guid} requestedChatId={chat} onClose={close} />;
}
