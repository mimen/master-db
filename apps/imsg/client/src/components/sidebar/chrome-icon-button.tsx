import { Ionicons } from "@expo/vector-icons";
import { forwardRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";

import { chromeControlFill } from "./chrome-control-fill";
import { useChromeActions } from "./sidebar-chrome";

const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

export interface ChromeIconButtonProps {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  readonly color?: string;
}

/**
 * Sidebar chrome action — hover/press fill, and excluded from the Tauri
 * title-bar drag region so the pointer actually hits it.
 */
export const ChromeIconButton = forwardRef<View, ChromeIconButtonProps>(
  function ChromeIconButton({ icon, accessibilityLabel, onPress, color }, ref): React.JSX.Element {
    const theme = useTheme();
    const chrome = useChromeActions();
    const [hovered, setHovered] = useState(false);
    return (
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        {...NO_DRAG}
        style={({ pressed }) => [
          chrome.button,
          styles.round,
          chromeControlFill(theme, { hovered, pressed }),
          Platform.OS === "web" ? ({ cursor: "pointer" } as object) : null,
        ]}
      >
        <Ionicons name={icon} size={chrome.iconSize} color={color ?? theme.accent} />
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  round: {
    borderRadius: 6,
  },
});
