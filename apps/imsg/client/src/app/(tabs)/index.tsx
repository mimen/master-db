import type { JSX } from "react";

import { MessagesWorkspace } from "@/components/messages-workspace";
import { useLayoutMode } from "@/hooks/use-layout-mode";

/**
 * Compact route adapter. On wide layouts the persistent root desktop shell
 * owns Messages while this Stack route stays mounted but intentionally inert.
 */
export default function ChatListScreen(): JSX.Element | null {
  const { wide } = useLayoutMode();
  if (wide) return null;
  return <MessagesWorkspace active wide={false} />;
}
