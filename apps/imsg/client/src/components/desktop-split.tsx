import type { ReactNode } from "react";
import { View } from "react-native";

import { useTheme } from "@/hooks/use-theme";
import { desktopFrame, type DesktopFrameStyles } from "@/lib/desktop-frame";
import { useSidebarWidth } from "@/lib/sidebar-width";

import { SidebarResizeHandle } from "./sidebar/sidebar-resize-handle";

export function useDesktopFrame(): {
  frame: DesktopFrameStyles;
  listWidth: number;
  setListWidth: (next: number) => void;
} {
  const theme = useTheme();
  const [listWidth, setListWidth] = useSidebarWidth();
  return { frame: desktopFrame(theme, listWidth), listWidth, setListWidth };
}

export interface DesktopSplitProps {
  readonly list: ReactNode;
  readonly detail: ReactNode;
  readonly children?: ReactNode;
}

/** Shared Messages/Contacts desktop shell: list | drag | thread, optional extra panes. */
export function DesktopSplit({ list, detail, children }: DesktopSplitProps): React.JSX.Element {
  const { frame, listWidth, setListWidth } = useDesktopFrame();
  return (
    <View style={frame.split}>
      <View style={[frame.pane, frame.listPane]}>
        {list}
        <SidebarResizeHandle width={listWidth} onResize={setListWidth} />
      </View>
      <View style={[frame.pane, frame.detailPane]}>{detail}</View>
      {children}
    </View>
  );
}

export function DesktopAuxPane({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const { frame } = useDesktopFrame();
  return <View style={[frame.pane, frame.auxPane]}>{children}</View>;
}
