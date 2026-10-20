import { router, useLocalSearchParams } from "expo-router";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { AgentPane } from "@/components/lazy-surfaces";

/** The phone's Agent tab. Wide screens open the same pane in the shell's utility surface. */
export default function AgentScreen(): React.JSX.Element | null {
  const { guid } = useLocalSearchParams<{ guid: string }>();
  const { wide } = useLayoutMode();
  if (wide || !guid) return null;
  return <AgentPane chatGuid={guid} onClose={() => router.back()} />;
}
