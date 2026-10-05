import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { IconButton } from "@/components/ui/icon-button";
import { useTheme } from "@/hooks/use-theme";
import { isDesktopShell, watchDesktopFullscreen } from "@/lib/desktop-shell";
import { headerFace } from "@/lib/header-font";

const DRAG = { dataSet: { tauriDragRegion: "" } } as object;
const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

/** Room for the native traffic lights at (14,14) in the desktop shell. */
export const TRAFFIC_LIGHT_RESERVE = 68;
export const SIDEBAR_BRAND_HEIGHT = 48;

/** Native lights show outside fullscreen only, so the reserve follows them. */
function useTrafficLightReserve(): number {
  const shell = isDesktopShell();
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => (shell ? watchDesktopFullscreen(setFullscreen) : undefined), [shell]);
  return shell && !fullscreen ? TRAFFIC_LIGHT_RESERVE : 0;
}

/** The comma mark: an ink tile with a header-face comma. */
function CommaMark(): React.JSX.Element {
  const theme = useTheme();
  return (
    <View aria-hidden style={[styles.mark, { backgroundColor: theme.text }]}>
      <Text style={[styles.markGlyph, { color: theme.background }]}>,</Text>
    </View>
  );
}

/**
 * The wide sidebar's fixed top: the brand row (a drag region in the desktop
 * shell, after the traffic-light reserve), the search row, and an optional
 * row under it (the lens tabs, or the Contacts heading).
 */
export function SidebarHeader({
  search,
  actions,
  below,
  testID,
}: {
  readonly search: ReactNode;
  readonly actions: ReactNode;
  readonly below?: ReactNode;
  readonly testID?: string;
}): React.JSX.Element {
  const theme = useTheme();
  const reserve = useTrafficLightReserve();
  return (
    <View testID={testID} style={[styles.header, { backgroundColor: theme.background, borderBottomColor: theme.divider }]}>
      <View style={[styles.brandRow, { paddingLeft: reserve ? reserve + 11 : 14 }]} {...DRAG}>
        {/* Collapse arrives with the sidebar toggle (⌘\); the control is drawn so the header matches. */}
        <IconButton label="Toggle sidebar" disabled onPress={() => undefined} style={styles.toggle}>
          <HugeiconsIcon icon={SidebarLeftIcon} size={17} color={theme.icon} strokeWidth={1.6} />
        </IconButton>
        <CommaMark />
        <Text accessibilityRole="header" selectable={false} style={[styles.brand, { color: theme.text }]}>Comma</Text>
      </View>
      <View style={styles.searchRow} {...NO_DRAG}>
        {search}
        <View style={styles.actions}>{actions}</View>
      </View>
      {below ? <View style={styles.below} {...NO_DRAG}>{below}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { borderBottomWidth: StyleSheet.hairlineWidth },
  brandRow: { alignItems: "center", flexDirection: "row", gap: 8, height: SIDEBAR_BRAND_HEIGHT, paddingRight: 10 },
  toggle: { opacity: 1 },
  mark: { alignItems: "center", borderRadius: 5, height: 18, overflow: "hidden", width: 18 },
  markGlyph: { ...headerFace, fontSize: 17, lineHeight: 15 },
  brand: { ...headerFace, fontSize: 15.5, letterSpacing: -0.2 },
  searchRow: { alignItems: "center", flexDirection: "row", gap: 2, paddingLeft: 12, paddingRight: 10, paddingTop: 2 },
  actions: { flexDirection: "row", gap: 2, marginLeft: 4 },
  below: { paddingHorizontal: 14, paddingTop: 14 },
});
