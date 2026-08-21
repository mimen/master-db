import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { useTheme } from "@/hooks/use-theme";
import { useTriageTheme } from "@/hooks/use-triage-theme";
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
  /** Fixed chrome placed inside the resizable list pane, such as the triage rail. */
  readonly listInset?: number;
}

/** Shared Messages/Contacts desktop shell: list | drag | thread, optional extra panes. */
export function DesktopSplit({ list, detail, children, listInset = 0 }: DesktopSplitProps): React.JSX.Element {
  const { frame, listWidth, setListWidth } = useDesktopFrame();
  const visual = useTriageTheme();
  const renderedListWidth = listWidth + listInset;
  const deskGround = Platform.OS === "web" ? ({ backgroundImage: visual.deskGradient } as object) : { backgroundColor: visual.desk };
  return (
    <View style={[frame.split, deskGround, styles.desk]}>
      <View style={[frame.pane, frame.listPane, { flexBasis: renderedListWidth, width: renderedListWidth }]}>
        {list}
        <SidebarResizeHandle width={renderedListWidth} onResize={(next) => setListWidth(next - listInset)} />
      </View>
      <View style={[frame.pane, frame.detailPane]}>{detail}</View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  desk: {
    gap: 10,
    padding: 10,
  },
});

const SLIDE_MS = 220;
const SLIDE_EASE = Easing.out(Easing.cubic);

export function DesktopAuxPane({
  open,
  children,
}: {
  readonly open: boolean;
  readonly children: ReactNode;
}): React.JSX.Element | null {
  const visual = useTriageTheme();
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
    flexBasis: width.value,
    width: width.value,
  }));

  if (!mounted) return null;

  return (
    <Animated.View
      style={[
        {
          backgroundColor: visual.inspector,
          borderRadius: 12,
          flexGrow: 0,
          flexShrink: 0,
          overflow: "hidden",
        },
        slide,
      ]}
    >
      <View style={[{ flex: 1, width: AUX_PANE_WIDTH }, Platform.OS === "web" ? ({ backdropFilter: "blur(40px) saturate(1.5)", WebkitBackdropFilter: "blur(40px) saturate(1.5)" } as object) : null]}>{held.current}</View>
    </Animated.View>
  );
}
