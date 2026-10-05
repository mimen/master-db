import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { isDesktopShell } from "@/lib/desktop-shell";

export interface SidebarFrameProps {
  /** Wide: the SidebarHeader, in the flow. Phone: the floating SidebarChrome. */
  readonly chrome: React.ReactNode;
  /** Wide: the workspace footer. */
  readonly footer?: React.ReactNode;
  /** Synthetic scroll thumb overlay, if the pane renders one. */
  readonly thumb?: React.ReactNode;
  /** The scrolling body (the list). */
  readonly children: React.ReactNode;
}

/**
 * Structural shell shared by the Messages and Contacts sidebars: safe area,
 * the chrome, a relative body host for the list and thumb, then the footer.
 * Wide chrome stacks above the list; the phone bar floats over it. Owns only
 * the left pane; the desktop split is screen-level layout.
 */
export function SidebarFrame({
  chrome,
  footer,
  thumb,
  children,
}: SidebarFrameProps): React.JSX.Element {
  const theme = useTheme();
  const { wide } = useLayoutMode();
  const shell = isDesktopShell();
  return (
    <SafeAreaView style={[styles.pane, { backgroundColor: theme.background }]} edges={shell || wide ? [] : ["top"]}>
      {wide ? chrome : null}
      <View style={styles.listWrap}>
        {/* The phone bar floats over the list but comes first in the DOM, so Tab and
            screen readers reach its actions before the rows. */}
        {wide ? null : chrome}
        {children}
        {thumb}
      </View>
      {footer}
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
