import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet } from "react-native";

import { SIDEBAR_SCROLL_FADE } from "@/lib/sidebar-metrics";

function toTransparent(hex: string): string {
  if (hex.length === 7 && hex.startsWith("#")) return `${hex}00`;
  return "transparent";
}

export function SidebarScrollFades({
  background,
  chromeHeight,
  footerHeight,
}: {
  readonly background: string;
  readonly chromeHeight: number;
  readonly footerHeight: number;
}): React.JSX.Element {
  const fadeTo = toTransparent(background);
  return (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={[background, fadeTo]}
        style={[styles.fade, { top: chromeHeight, height: SIDEBAR_SCROLL_FADE }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[fadeTo, background]}
        style={[styles.fade, { bottom: footerHeight, height: SIDEBAR_SCROLL_FADE }]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  fade: {
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 9,
  },
});
