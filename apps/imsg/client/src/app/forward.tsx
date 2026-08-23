import { router } from "expo-router";

import { ForwardContent } from "@/components/forward-content";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { selectChat } from "@/lib/selection";

export default function ForwardScreen(): React.JSX.Element | null {
  const { wide } = useLayoutMode();
  if (wide) return null;
  return (
    <ForwardContent
      onClose={() => router.back()}
      onOpenChat={(chat) => {
        if (!selectChat({ guid: chat.guid, name: chat.displayName })) {
          router.replace({ pathname: "/chat/[guid]", params: { guid: chat.guid, name: chat.displayName } });
        }
      }}
    />
  );
}
