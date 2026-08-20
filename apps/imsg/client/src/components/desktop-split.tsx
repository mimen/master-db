import { useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { useTheme } from "@/hooks/use-theme";
import { AUX_PANE_WIDTH, desktopFrame, type DesktopFrameStyles } from "@/lib/desktop-frame";
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

const SLIDE_MS = 220;
const SLIDE_EASE = Easing.out(Easing.cubic);

export function DesktopAuxPane({
  open,
  children,
}: {
  readonly open: boolean;
  readonly children: ReactNode;
}): React.JSX.Element | null {
  const theme = useTheme();
  const [mounted, setMounted] = useState(open);
  const held = useRef(children);
  if (open && children != null) held.current = children;

  const width = useSharedValue(0);

  useEffect(() => {
    if (open) {
      setMounted(true);
      width.value = withTiming(AUX_PANE_WIDTH, { duration: SLIDE_MS, easing: SLIDE_EASE });
      return;
    }
    width.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
  }, [open, width]);

  const slide = useAnimatedStyle(() => ({
    borderLeftWidth: width.value > 2 ? 1 : 0,
    flexBasis: width.value,
    width: width.value,
  }));

  if (!mounted) return null;

  return (
    <Animated.View
      style={[
        {
          backgroundColor: theme.background,
          borderLeftColor: theme.divider,
          flexGrow: 0,
          flexShrink: 0,
          overflow: "hidden",
        },
        slide,
      ]}
    >
      <View style={{ flex: 1, width: AUX_PANE_WIDTH }}>{held.current}</View>
    </Animated.View>
  );
}
