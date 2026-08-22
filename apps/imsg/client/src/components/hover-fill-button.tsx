import { useState, type ReactNode } from "react";
import { Pressable, type GestureResponderEvent, type Insets, type StyleProp, type ViewStyle } from "react-native";

/** Button whose hover/press language is the fill, not the icon. */
export function HoverFillButton({
  accessibilityLabel,
  restFill,
  hoverFill,
  onPress,
  disabled,
  hitSlop,
  style,
  children,
}: {
  accessibilityLabel: string;
  restFill: string;
  hoverFill: string;
  onPress: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  hitSlop?: number | Insets;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}): React.JSX.Element {
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
        style,
        { backgroundColor: hovered || pressed ? hoverFill : restFill },
        pressed && { opacity: 0.82 },
      ]}
    >
      {children}
    </Pressable>
  );
}
