import type { ReactNode } from "react";
import { Pressable, StyleSheet, type GestureResponderEvent, type Insets, type StyleProp, type ViewStyle } from "react-native";

import { Radius } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";

import { focusRing, focusVisible, stepFill, type InteractionState } from "./interaction";

export const ICON_BUTTON_SIZE = 28;

export interface IconButtonProps {
  /** The accessible name. Required: an icon alone names nothing. */
  readonly label: string;
  readonly onPress: (event: GestureResponderEvent) => void;
  readonly disabled?: boolean;
  readonly hitSlop?: number | Insets;
  readonly style?: StyleProp<ViewStyle>;
  /** The glyph. A function receives `active` to brighten it on hover and press. */
  readonly children: ReactNode | ((state: { active: boolean }) => ReactNode);
}

/** A 28pt square icon control. Hover and press step the fill; keyboard focus draws the ring. */
export function IconButton({ label, onPress, disabled, hitSlop, style, children }: IconButtonProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={hitSlop ?? 8}
      onPress={onPress}
      style={(state: InteractionState) => [
        styles.base,
        { backgroundColor: stepFill(theme, state, "transparent") },
        disabled && styles.disabled,
        focusVisible(state) && focusRing(theme),
        style,
      ]}
    >
      {(state: InteractionState) =>
        typeof children === "function" ? children({ active: Boolean(state.hovered || state.pressed) }) : children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: Radius.sm,
    height: ICON_BUTTON_SIZE,
    justifyContent: "center",
    width: ICON_BUTTON_SIZE,
  },
  disabled: { opacity: 0.4 },
});
