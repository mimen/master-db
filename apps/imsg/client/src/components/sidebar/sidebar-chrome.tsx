import { Platform, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { isDesktopShell } from "@/lib/desktop-shell";
import {
  SIDEBAR_NAV_HEIGHT,
  SIDEBAR_TITLE_HEIGHT,
  SIDEBAR_TOOLBAR_HEIGHT,
} from "@/lib/sidebar-metrics";
import { WORDMARK_FONT } from "@/lib/wordmark-font";

import { SIDEBAR_CHROME_HEIGHT } from "./use-synthetic-scroll-metrics";

/** Icon glyph size inside the chrome action buttons. */
export const CHROME_ICON_SIZE = { compact: 16, regular: 21 } as const;

const DRAG = { dataSet: { tauriDragRegion: "" } } as object;
const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

export interface SidebarChromeProps {
  /** Left slot: the pane's search field on mobile. Null on wide (toolbar). */
  readonly leading: React.ReactNode;
  /** Right slot: new-message on wide; settings/filter/new on mobile. */
  readonly actions: React.ReactNode;
  /** Wide: title shown above the search row. */
  readonly title?: string;
  /** Wide: sticky search row under the title. */
  readonly toolbar?: React.ReactNode;
  /** Wide: Messages/Contacts on its own row under search. */
  readonly nav?: React.ReactNode;
}

/**
 * The fixed frosted-glass top bar shared by both sidebars — the only fixed
 * top chrome. No hairlines. Wide is three rows: wordmark, search + new, then
 * the Messages/Contacts switcher. Mobile stays a single bar with search inline.
 */
export function SidebarChrome({
  leading,
  actions,
  title = "Comma,",
  toolbar,
  nav,
}: SidebarChromeProps): React.JSX.Element {
  const theme = useTheme();
  const { wide } = useLayoutMode();
  const shell = isDesktopShell();
  const compact = wide || shell;
  const glassStyle =
    Platform.OS === "web"
      ? ({
          backgroundColor: `${theme.background}F2`,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
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
        <View style={styles.titleRow}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            selectable={false}
            style={[styles.wordmark, { color: theme.text }]}
          >
            {title}
          </Text>
        </View>
        <View style={styles.toolbar} {...(shell ? NO_DRAG : {})}>
          {toolbar}
          {actionCluster}
        </View>
        {nav ? (
          <View style={styles.navRow} {...(shell ? NO_DRAG : {})}>
            {nav}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[styles.bar, glassStyle, compact && styles.barCompact]}
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
    height: SIDEBAR_TITLE_HEIGHT,
    paddingHorizontal: 12,
  },
  wordmark: {
    flexShrink: 0,
    fontFamily: WORDMARK_FONT,
    fontSize: 22,
    // Line box = glyph box so the parent row's alignItems centers against
    // the traffic lights (12px at y:20 → center 26, in a 52px row).
    lineHeight: 22,
    // Coolvetica's em-box sits optically high; 1px down matches the lights.
    transform: [{ translateY: 1 }],
  },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    height: SIDEBAR_TOOLBAR_HEIGHT,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  navRow: {
    flexDirection: "row",
    height: SIDEBAR_NAV_HEIGHT,
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
  actions: {
    flexDirection: "row",
    flexShrink: 0,
    gap: 2,
  },
});
