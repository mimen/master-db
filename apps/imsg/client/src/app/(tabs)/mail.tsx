import { useNavigation } from "expo-router";
import { useCallback, type JSX } from "react";

import { MailWorkspace } from "@/components/lazy-surfaces";
import { useLayoutMode } from "@/hooks/use-layout-mode";

/** Compact route adapter. On wide layouts the persistent desktop shell owns Mail and this route stays inert. */
export default function MailScreen(): JSX.Element | null {
  const { wide } = useLayoutMode();
  const navigation = useNavigation();
  // The reader is pushed over the list, so the tab bar steps aside as it does for a Messages thread.
  const onReader = useCallback((open: boolean) => navigation.setOptions({ tabBarStyle: open ? { position: "absolute", display: "none" } : { position: "absolute" } }), [navigation]);
  if (wide) return null;
  return <MailWorkspace wide={false} onReader={onReader} />;
}
