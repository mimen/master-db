import { Platform, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { useType } from "@/hooks/use-type";
import { DESKTOP_TRAFFIC_LIGHT_INSET, isDesktopShell } from "@/lib/desktop-shell";
import { SIDEBAR_TITLE_HEIGHT, SIDEBAR_TOOLBAR_HEIGHT } from "@/lib/sidebar-metrics";

import { SIDEBAR_CHROME_HEIGHT } from "./use-synthetic-scroll-metrics";

/** Icon glyph size inside the chrome action buttons. */
export const CHROME_ICON_SIZE = { compact: 16, regular: 21 } as const;

const DRAG = { dataSet: { tauriDragRegion: "" } } as object;
const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

export interface SidebarChromeProps {
  /** Left slot: the pane's search field on mobile. Null on wide (toolbar). */
  readonly leading: React.ReactNode;
  /** Right slot: the pane's action buttons. */
  readonly actions: React.ReactNode;
  /** Wide: sticky search row under the app name. */
  readonly toolbar?: React.ReactNode;
  /** Wide: sits in the title row after the wordmark (priority shelf). */
  readonly titleAccessory?: React.ReactNode;
}

/**
 * The fixed frosted-glass top bar shared by both sidebars — the only fixed
 * chrome. Content scrolls behind it at ~10% with a blur (web-only
 * backdrop-filter; solid elsewhere). Behavior lives with the caller; this
 * component owns only geometry and glass.
 *
 * Wide/desktop is two rows, T3-style: app name (+ optional shelf) on the
 * traffic-light row, search and actions on the row below. Mobile stays a
 * single bar with search inline.
 */
export function SidebarChrome({
  leading,
  actions,
  toolbar,
  titleAccessory,
}: SidebarChromeProps): React.JSX.Element {
  const theme = useTheme();
  const type = useType();
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
  const dragProps = shell ? DRAG : {};

  const actionCluster = (
    <View style={styles.actions} {...(shell ? NO_DRAG : {})}>
      {actions}
    </View>
  );

  if (wide && toolbar) {
    return (
      <View style={[styles.stack, glassStyle]} {...dragProps}>
        <View style={[styles.titleRow, shell && styles.titleRowShell]}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            selectable={false}
            style={[styles.wordmark, { color: theme.text, fontSize: type.title }]}
          >
            Comma
          </Text>
          {titleAccessory ? (
            <View style={styles.accessory} {...(shell ? NO_DRAG : {})}>
              {titleAccessory}
            </View>
          ) : null}
        </View>
        <View style={styles.toolbar} {...(shell ? NO_DRAG : {})}>
          {toolbar}
          {actionCluster}
        </View>
      </View>
    );
  }

  return (
    <View
      style={[styles.bar, glassStyle, compact && styles.barCompact, shell && styles.barShell]}
      {...dragProps}
    >
      {leading}
      {actionCluster}
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
  stack: {
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 10,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    height: SIDEBAR_TITLE_HEIGHT,
    paddingHorizontal: 12,
  },
  titleRowShell: {
    paddingLeft: DESKTOP_TRAFFIC_LIGHT_INSET,
  },
  wordmark: {
    flexShrink: 0,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  accessory: {
    flex: 1,
    minWidth: 0,
  },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    height: SIDEBAR_TOOLBAR_HEIGHT,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
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
