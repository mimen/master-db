import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "@/hooks/use-theme";

export interface SidebarFrameProps {
  /** The fixed glass bar content — a SidebarChrome. */
  readonly chrome: React.ReactNode;
  /** Synthetic scroll thumb overlay, if the pane renders one. */
  readonly thumb?: React.ReactNode;
  /** The scrolling body (the list). */
  readonly children: React.ReactNode;
}

/**
 * Structural shell shared by the Messages and Contacts sidebars: safe area,
 * a relative body host whose content scrolls BEHIND the fixed chrome, and
 * the thumb overlay seam. Owns only the left pane — the desktop floating
 * cards/split are screen-level layout and must never live here.
 */
export function SidebarFrame({ chrome, thumb, children }: SidebarFrameProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.pane, { backgroundColor: theme.background }]} edges={["top"]}>
      <View style={styles.listWrap}>
        {children}
        {thumb}
        {chrome}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pane: {
    flex: 1,
  },
  listWrap: {
    flex: 1,
    position: "relative",
  },
});
