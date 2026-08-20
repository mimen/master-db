import { Platform, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { useTriageTheme } from "@/hooks/use-triage-theme";
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
  readonly chromeHeight?: number;
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
  chromeHeight,
}: SidebarFrameProps): React.JSX.Element {
  const theme = useTheme();
  const visual = useTriageTheme();
  const { wide } = useLayoutMode();
  const shell = isDesktopShell();
  const effectiveChromeHeight = chromeHeight ?? sidebarChromeHeight(wide);
  const wideSurface = wide && Platform.OS === "web" ? ({
    backgroundColor: visual.queue,
    backdropFilter: "blur(40px) saturate(1.5)",
    WebkitBackdropFilter: "blur(40px) saturate(1.5)",
  } as object) : { backgroundColor: wide ? visual.queue : theme.background };
  return (
    <SafeAreaView
      style={[styles.pane, wideSurface]}
      edges={shell ? [] : ["top"]}
    >
      <View style={styles.listWrap}>
        {children}
        {thumb}
        {wide ? (
          <SidebarScrollFades
            background={wide ? visual.queue : theme.background}
            chromeHeight={effectiveChromeHeight}
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
