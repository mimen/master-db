import { router, useLocalSearchParams } from "expo-router";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { ChatInfoContent } from "@/components/lazy-surfaces";
import type { ConversationId } from "@shared/types";

export default function ChatInfoScreen(): React.JSX.Element | null {
  const { conversation } = useLocalSearchParams<{ conversation: ConversationId }>();
  const { wide } = useLayoutMode();
  if (wide || !conversation) return null;
  return (
    <ChatInfoContent
      conversationId={conversation}
      onClose={() => router.back()}
      onDeleted={() => {
        router.dismissAll?.();
        router.replace("/");
      }}
    />
  );
}
