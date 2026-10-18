import type { ReactNode } from "react";
import { View } from "react-native";

import { type MenuAnchor, useWebContextMenu } from "@/lib/use-web-context-menu";

/** Right-click (and the Menu key) on its children opens `onMenu` on desktop web. */
export function ContextMenuArea({ onMenu, children }: { readonly onMenu: (anchor?: MenuAnchor) => void; readonly children: ReactNode }) {
  const ref = useWebContextMenu<View>(onMenu);
  return <View ref={ref}>{children}</View>;
}
