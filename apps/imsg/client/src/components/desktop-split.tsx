import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { useTriageTheme } from "@/hooks/use-triage-theme";
import { AUX_PANE_WIDTH, desktopFrame, type DesktopFrameStyles } from "@/lib/desktop-frame";
import { useSidebarWidth } from "@/lib/sidebar-width";

import { OverlayShell } from "./overlay-shell";
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
    <View style={[frame.split, deskGround]}>
      <View style={[frame.pane, frame.listPane, { flexBasis: renderedListWidth, width: renderedListWidth }]}>
        {list}
        <SidebarResizeHandle width={renderedListWidth} onResize={(next) => setListWidth(next - listInset)} />
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
    borderLeftWidth: width.value > 2 ? 0.5 : 0,
    flexBasis: width.value,
    width: width.value,
  }));

  if (!mounted) return null;

  return (
    <Animated.View
      style={[
        {
          backgroundColor: visual.inspector,
          borderLeftColor: visual.hairline,
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

/**
 * One responsive utility surface for every wide screen. At the three-column
 * breakpoint it is an animated auxiliary pane; below that it is the same
 * full-height right-edge overlay. Callers supply only open state and content,
 * so Scheduled/Settings cannot drift between Messages and Contacts.
 */
export function DesktopUtilityPane({
  open,
  onClose,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): React.JSX.Element {
  const { canShadow } = useLayoutMode();
  const visual = useTriageTheme();
  const auxPresentation = useRef(canShadow);
  const wasOpen = useRef(open);
  const held = useRef(children);
  if (open && !wasOpen.current) auxPresentation.current = canShadow;
  if (open && children != null) held.current = children;
  wasOpen.current = open;

  // Presentation is captured when the pane opens and held until it closes.
  // Resizing cannot remount live content, while the next open always uses the
  // current breakpoint immediately — no timer or stale closed-state window.
  const content = (
    <View
      testID="desktop-utility-pane-content"
      style={styles.utilityContent}
      {...({ dataSet: { utilityPresentation: auxPresentation.current ? "pane" : "overlay" } } as object)}
    >
      {held.current}
    </View>
  );

  if (auxPresentation.current) return <DesktopAuxPane open={open}>{content}</DesktopAuxPane>;
  return (
    <OverlayShell
      visible={open}
      onClose={onClose}
      backdropStyle={styles.utilityOverlayBackdrop}
      cardStyle={[styles.utilityOverlayCard, { backgroundColor: visual.inspector, borderColor: visual.hairline }]}
    >
      {content}
    </OverlayShell>
  );
}

const styles = StyleSheet.create({
  utilityContent: {
    flex: 1,
    width: AUX_PANE_WIDTH,
  },
  utilityOverlayBackdrop: {
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  utilityOverlayCard: {
    borderLeftWidth: 0.5,
    borderRadius: 0,
    height: "100%",
    width: AUX_PANE_WIDTH,
  },
});
