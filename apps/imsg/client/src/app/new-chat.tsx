import { router, useLocalSearchParams } from "expo-router";
import { goBackOrHome } from "@/lib/back-navigation";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { NewChatContent } from "@/components/lazy-surfaces";

export default function NewChatScreen(): React.JSX.Element | null {
  const { address, name } = useLocalSearchParams<{ address?: string; name?: string }>();
  const { wide } = useLayoutMode();
  if (wide) return null;
  return (
    <NewChatContent
      presentation="screen"
      onClose={() => goBackOrHome(router)}
      initialContact={address ? { address, name: name || address } : undefined}
    />
  );
}
