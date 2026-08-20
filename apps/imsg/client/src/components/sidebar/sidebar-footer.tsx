import { StyleSheet, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";
import { isDesktopShell } from "@/lib/desktop-shell";
import { SIDEBAR_FOOTER_HEIGHT } from "@/lib/sidebar-metrics";

const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

export function SidebarFooter({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const theme = useTheme();
  const shell = isDesktopShell();
  return (
    <View
      style={[styles.footer, { backgroundColor: theme.background }]}
      {...(shell ? NO_DRAG : {})}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    alignItems: "center",
    bottom: 0,
    flexDirection: "row",
    height: SIDEBAR_FOOTER_HEIGHT,
    left: 0,
    paddingHorizontal: 10,
    position: "absolute",
    right: 0,
    zIndex: 10,
  },
});
