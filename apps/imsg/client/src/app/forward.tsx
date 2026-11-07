import { router } from "expo-router";
import { ForwardContent } from "@/components/lazy-surfaces";

import { useLayoutMode } from "@/hooks/use-layout-mode";
import { conversationRoute, selectChat } from "@/lib/selection";

export default function ForwardScreen(): React.JSX.Element | null {
  const { wide } = useLayoutMode();
  if (wide) return null;
  return (
    <ForwardContent
      onClose={() => router.back()}
      onOpenChat={(chat) => {
        if (!selectChat({ conversationId: chat.conversationId, name: chat.displayName })) {
          router.replace(conversationRoute(chat.conversationId));
        }
      }}
    />
  );
}
