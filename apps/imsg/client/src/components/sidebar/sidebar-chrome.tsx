import { Platform, StyleSheet, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";

import { SIDEBAR_CHROME_HEIGHT } from "./use-synthetic-scroll-metrics";

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
  return (
    <View style={[styles.bar, glassStyle]}>
      {leading}
      <View style={styles.actions}>{actions}</View>
    </View>
  );
}

/** Shared 38px square action-button geometry for chrome icons. */
export const chromeStyles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    height: 38,
    justifyContent: "center",
    width: 38,
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
  actions: {
    flexDirection: "row",
    gap: 2,
  },
});
