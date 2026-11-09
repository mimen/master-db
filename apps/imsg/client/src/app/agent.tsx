import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ConversationId } from "@shared/types";
import { useAgentEnabled } from "@/hooks/use-agent";
import { useAiStatus } from "@/hooks/use-ai";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { AgentPane } from "@/components/lazy-surfaces";

const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

/** The phone's Agent tab. Wide screens open the same pane in the shell's utility surface. */
export default function AgentScreen(): React.JSX.Element | null {
  const { conversation, chat } = useLocalSearchParams<{ conversation: ConversationId; chat?: string }>();
  const { wide } = useLayoutMode();
  const enabled = useAgentEnabled();
  const { loaded } = useAiStatus();
  const theme = useTheme();
  // A runner that goes stale, or the setting turning off, dismisses the tab. A cold load waits for the first status.
  useEffect(() => {
    if (!wide && loaded && !enabled) close();
  }, [wide, loaded, enabled]);
  if (wide || !conversation || !enabled) return null;
  return (
    <SafeAreaView edges={["bottom"]} style={{ flex: 1, backgroundColor: theme.background }}>
      <AgentPane conversationId={conversation} requestedChatId={chat} onClose={close} />
    </SafeAreaView>
  );
}
