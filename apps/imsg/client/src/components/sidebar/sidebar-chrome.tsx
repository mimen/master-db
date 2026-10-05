import { Platform, StyleSheet, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";
import { SIDEBAR_TITLE_HEIGHT } from "@/lib/sidebar-metrics";

/**
 * The phone list's fixed top bar: the actions sit on the right and the list
 * scrolls under the frosted bar. The lens tabs below it are the page title.
 */
export function SidebarChrome({ actions }: { readonly actions: React.ReactNode }): React.JSX.Element {
  const theme = useTheme();
  const glass =
    Platform.OS === "web"
      ? ({ backgroundColor: `${theme.background}EB`, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" } as object)
      : { backgroundColor: theme.background };
  return (
    <View style={[styles.bar, glass]}>
      <View style={styles.actions}>{actions}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    flexDirection: "row",
    height: SIDEBAR_TITLE_HEIGHT,
    justifyContent: "flex-end",
    left: 0,
    paddingHorizontal: 12,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 10,
  },
  actions: { flexDirection: "row", gap: 4 },
});
