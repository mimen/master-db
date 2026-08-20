import { Pressable, StyleSheet, View } from "react-native";
import {
  closeDesktopWindow,
  isDesktopShell,
  minimizeDesktopWindow,
  toggleMaximizeDesktopWindow,
} from "@/lib/desktop-shell";

const controls = [
  { color: "#FF5F57", label: "Close window", action: closeDesktopWindow },
  { color: "#FEBC2E", label: "Minimize window", action: minimizeDesktopWindow },
  { color: "#28C840", label: "Zoom window", action: toggleMaximizeDesktopWindow },
] as const;

export function DesktopWindowControls(): React.JSX.Element | null {
  const shell = isDesktopShell();
  if (!shell) return null;
  return (
    <View
      testID="window-controls"
      accessibilityLabel="Window controls"
      style={styles.stack}
      {...({ dataSet: { tauriDragRegion: "false" } } as object)}
    >
      {controls.map((control) => (
        <Pressable
          key={control.label}
          accessibilityRole="button"
          accessibilityLabel={control.label}
          onPress={() => control.action()}
          style={({ pressed, hovered }) => [
            styles.control,
            { backgroundColor: control.color },
            shell && (pressed || hovered) && styles.controlHover,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    alignItems: "center",
    gap: 8,
    height: 52,
    justifyContent: "flex-start",
  },
  control: {
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  controlHover: {
    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.22)",
  },
});
