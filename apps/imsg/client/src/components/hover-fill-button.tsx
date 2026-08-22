import { useState, type ReactNode } from "react";
import { Pressable, type GestureResponderEvent, type StyleProp, type ViewStyle } from "react-native";

/** Button whose hover/press language is the fill, not the icon. */
export function HoverFillButton({
  accessibilityLabel,
  restFill,
  hoverFill,
  onPress,
  disabled,
  style,
  children,
}: {
  accessibilityLabel: string;
  restFill: string;
  hoverFill: string;
  onPress: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[style, { backgroundColor: hovered ? hoverFill : restFill }]}
    >
      {children}
    </Pressable>
  );
}
