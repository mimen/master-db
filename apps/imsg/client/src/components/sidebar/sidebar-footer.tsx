import { Platform, StyleSheet, View } from "react-native";

import { useTriageTheme } from "@/hooks/use-triage-theme";
import { isDesktopShell } from "@/lib/desktop-shell";
import { SIDEBAR_FOOTER_HEIGHT } from "@/lib/sidebar-metrics";

const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

export function SidebarFooter({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const visual = useTriageTheme();
  const shell = isDesktopShell();
  const surface = Platform.OS === "web" ? ({
    backgroundColor: visual.queue,
    backdropFilter: "blur(40px) saturate(1.5)",
    WebkitBackdropFilter: "blur(40px) saturate(1.5)",
  } as object) : { backgroundColor: visual.queue };
  return (
    <View
      style={[styles.footer, surface, { borderTopColor: visual.hairline }]}
      {...(shell ? NO_DRAG : {})}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    borderTopWidth: 0.5,
    bottom: 0,
    height: SIDEBAR_FOOTER_HEIGHT,
    justifyContent: "center",
    left: 0,
    paddingHorizontal: 10,
    position: "absolute",
    right: 0,
    zIndex: 10,
  },
});
