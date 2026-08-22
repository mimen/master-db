import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  closeDesktopWindow,
  isDesktopShell,
  minimizeDesktopWindow,
  toggleMaximizeDesktopWindow,
} from "@/lib/desktop-shell";

const controls = [
  { color: "#FF5F57", glyph: "✕", label: "Close window", action: closeDesktopWindow },
  { color: "#FEBC2E", glyph: "−", label: "Minimize window", action: minimizeDesktopWindow },
  { color: "#28C840", glyph: "+", label: "Zoom window", action: toggleMaximizeDesktopWindow },
] as const;

/**
 * The macOS stoplight trio — a horizontal row at the window's top-left,
 * matching the system layout the chrome inset (`DESKTOP_TRAFFIC_LIGHT_INSET`)
 * was reserved against: 12px dots, 8px gaps, glyphs revealed on hover like
 * real AppKit window buttons. Rendered by the rail so it stays above every
 * pane; the rail itself is a drag region and clears it with NO_DRAG.
 */
export function DesktopWindowControls(): React.JSX.Element | null {
  const shell = isDesktopShell();
  const [hovered, setHovered] = useState(false);
  if (!shell) return null;
  return (
    <View
      testID="window-controls"
      accessibilityLabel="Window controls"
      style={styles.row}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      {...({ dataSet: { tauriDragRegion: "false" } } as object)}
    >
      {controls.map((control) => (
        <Pressable
          key={control.label}
          accessibilityRole="button"
          accessibilityLabel={control.label}
          onPress={() => control.action()}
          style={({ pressed }: { pressed?: boolean }) => [
            styles.control,
            { backgroundColor: control.color },
            pressed && styles.controlPressed,
          ]}
        >
          {/* Glyphs dim in per-button; opacity rides the group hover like macOS */}
          <Text style={[styles.glyph, { opacity: hovered ? 0.55 : 0 }]} selectable={false}>
            {control.glyph}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    height: 16,
  },
  control: {
    alignItems: "center",
    borderRadius: 6,
    height: 12,
    justifyContent: "center",
    overflow: "hidden",
    width: 12,
  },
  controlPressed: {
    opacity: 0.8,
  },
  glyph: {
    color: "rgba(0,0,0,0.62)",
    fontSize: 9,
    fontWeight: "700",
    lineHeight: 12,
    textAlign: "center",
  },
});
