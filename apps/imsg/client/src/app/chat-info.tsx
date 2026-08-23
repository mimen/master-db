import { router, useLocalSearchParams } from "expo-router";
import { ChatInfoContent } from "@/components/chat-info-content";
import { useLayoutMode } from "@/hooks/use-layout-mode";

export default function ChatInfoScreen(): React.JSX.Element | null {
  const { guid } = useLocalSearchParams<{ guid: string }>();
  const { wide } = useLayoutMode();
  if (wide) return null;
  return (
    <ChatInfoContent
      guid={guid ?? ""}
      onClose={() => router.back()}
      onDeleted={() => {
        router.dismissAll?.();
        router.replace("/");
      }}
    />
  );
}
