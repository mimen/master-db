import { Platform, StyleSheet, View, type ViewStyle } from "react-native";

import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { DESKTOP_TRAFFIC_LIGHT_INSET, isDesktopShell } from "@/lib/desktop-shell";

import { SIDEBAR_CHROME_HEIGHT } from "./use-synthetic-scroll-metrics";

/** Icon glyph size inside the chrome action buttons. */
export const CHROME_ICON_SIZE = { compact: 16, regular: 21 } as const;

export interface SidebarChromeProps {
  /** Left slot: NavSwitcher on desktop, the pane's search field on mobile. */
  readonly leading: React.ReactNode;
  /** Right slot: the pane's action buttons. */
  readonly actions: React.ReactNode;
}

/**
 * The fixed frosted-glass top bar shared by both sidebars — the only fixed
 * chrome. Content scrolls behind it at ~10% with a blur (web-only
 * backdrop-filter; solid elsewhere). Behavior lives with the caller; this
 * component owns only geometry and glass.
 */
export function SidebarChrome({ leading, actions }: SidebarChromeProps): React.JSX.Element {
  const theme = useTheme();
  const { wide } = useLayoutMode();
  const shell = isDesktopShell();
  const compact = wide || shell;
  const glassStyle =
    Platform.OS === "web"
      ? ({
          backgroundColor: `${theme.background}E6`,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottomColor: theme.divider,
          borderBottomWidth: StyleSheet.hairlineWidth,
        } as object)
      : { backgroundColor: theme.background };
  // RNW maps dataSet to data-* attributes; RN's types don't know it.
  const dragProps = shell ? ({ dataSet: { tauriDragRegion: "" } } as object) : {};
  return (
    <View
      style={[styles.bar, glassStyle, compact && styles.barCompact, shell && styles.barShell]}
      {...dragProps}
    >
      {leading}
      <View style={styles.actions}>{actions}</View>
    </View>
  );
}

export function useChromeActions(): { button: ViewStyle; iconSize: number } {
  const { wide } = useLayoutMode();
  const compact = wide || isDesktopShell();
  return {
    button: compact ? chromeStyles.actionButtonCompact : chromeStyles.actionButton,
    iconSize: compact ? CHROME_ICON_SIZE.compact : CHROME_ICON_SIZE.regular,
  };
}

/** Shared square action-button geometry for chrome icons. */
export const chromeStyles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  actionButtonCompact: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28,
  },
});

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    height: SIDEBAR_CHROME_HEIGHT,
    justifyContent: "space-between",
    left: 0,
    paddingHorizontal: 16,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 10,
  },
  barCompact: {
    paddingHorizontal: 10,
  },
  barShell: {
    paddingLeft: DESKTOP_TRAFFIC_LIGHT_INSET,
  },
  actions: {
    flexDirection: "row",
    flexShrink: 0,
    gap: 2,
  },
});
