import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { isDesktopShell } from "@/lib/desktop-shell";
import { sidebarChromeHeight, sidebarFooterHeight } from "@/lib/sidebar-metrics";

import { SidebarScrollFades } from "./sidebar-scroll-fades";

export interface SidebarFrameProps {
  /** The fixed glass bar content — a SidebarChrome. */
  readonly chrome: React.ReactNode;
  /** Wide: settings footer. */
  readonly footer?: React.ReactNode;
  /** Synthetic scroll thumb overlay, if the pane renders one. */
  readonly thumb?: React.ReactNode;
  /** The scrolling body (the list). */
  readonly children: React.ReactNode;
}

/**
 * Structural shell shared by the Messages and Contacts sidebars: safe area,
 * a relative body host whose content scrolls BEHIND the fixed chrome, and
 * the thumb overlay seam. Owns only the left pane — the desktop split is
 * screen-level layout and must never live here.
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
    <SafeAreaView
      style={[styles.pane, { backgroundColor: theme.background }]}
      edges={shell ? [] : ["top"]}
    >
      <View style={styles.listWrap}>
        {children}
        {thumb}
        {wide ? (
          <SidebarScrollFades
            background={theme.background}
            chromeHeight={sidebarChromeHeight(true)}
            footerHeight={sidebarFooterHeight(true)}
          />
        ) : null}
        {chrome}
        {footer}
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
