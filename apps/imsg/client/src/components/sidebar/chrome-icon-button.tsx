import { Ionicons } from "@expo/vector-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native";
import { forwardRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import { useTheme } from "@/hooks/use-theme";

import { useChromeActions } from "./sidebar-chrome";

const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

export interface ChromeIconButtonProps {
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly hugeIcon?: IconSvgElement;
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  readonly color?: string;
}

/**
 * Sidebar chrome action. Hover communicates through the glyph color rather
 * than another layer of button chrome.
 */
export const ChromeIconButton = forwardRef<View, ChromeIconButtonProps>(
  function ChromeIconButton({ icon, hugeIcon, accessibilityLabel, onPress, color }, ref): React.JSX.Element {
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
          pressed && styles.pressed,
          Platform.OS === "web" ? ({ cursor: "pointer" } as object) : null,
        ]}
      >
        {hugeIcon ? (
          <HugeiconsIcon icon={hugeIcon} size={chrome.iconSize} color={color ?? (hovered ? theme.text : theme.accent)} strokeWidth={1.8} />
        ) : (
          <Ionicons name={icon!} size={chrome.iconSize} color={color ?? (hovered ? theme.text : theme.accent)} />
        )}
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  pressed: { opacity: 0.65 },
});
