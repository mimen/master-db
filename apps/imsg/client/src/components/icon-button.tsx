import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, type GestureResponderEvent, type Insets, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "@/hooks/use-theme";

/**
 * The standard bare-icon button: hover raises a backgroundElement chip,
 * pressed steps to backgroundSelected, and children receive `active` so the
 * glyph can nudge from textSecondary/accent to full text. One language for
 * every icon control; roles and the web pointer cursor come with it.
 */
export function IconButton({
  accessibilityLabel,
  onPress,
  disabled,
  hitSlop,
  size = 30,
  style,
  children,
}: {
  accessibilityLabel: string;
  onPress: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  hitSlop?: number | Insets;
  /** Chip diameter; the glyph centers inside it. */
  size?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode | ((state: { active: boolean }) => ReactNode);
}): React.JSX.Element {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size },
        hovered && !pressed && { backgroundColor: theme.backgroundElement },
        pressed && { backgroundColor: theme.backgroundSelected },
        style,
      ]}
    >
      {(state) => (typeof children === "function" ? children({ active: hovered || state.pressed }) : children)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: 8,
    justifyContent: "center",
  },
});
