import { Pressable, StyleSheet, Text, type GestureResponderEvent, type StyleProp, type ViewStyle } from "react-native";

import { PRESS_DIM, HOVER_DIM } from "@/constants/interaction";
import { Radius, Space, Weight } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";

import { focusRing, focusVisible, stepFill, type InteractionState, type ThemeColors } from "./interaction";

export type ButtonVariant = "primary" | "ghost" | "danger";

export interface ButtonProps {
  readonly label: string;
  readonly onPress: (event: GestureResponderEvent) => void;
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

function colors(theme: ThemeColors, variant: ButtonVariant, state: InteractionState): { fill: string; text: string; opacity: number } {
  // Filled variants dim on hover and press; the ghost steps its fill.
  const dim = state.pressed ? PRESS_DIM : state.hovered ? HOVER_DIM : 1;
  switch (variant) {
    case "primary":
      return { fill: theme.accent, text: theme.onAccent, opacity: dim };
    case "danger":
      return { fill: theme.destructive, text: theme.onAccent, opacity: dim };
    case "ghost":
      return { fill: stepFill(theme, state, "transparent"), text: theme.text, opacity: 1 };
  }
}

/** A 32pt text button. One primary per view; peers are ghost. */
export function Button({ label, onPress, variant = "ghost", disabled, style }: ButtonProps): React.JSX.Element {
  const theme = useTheme();
  const type = useTypeRamp();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={(state: InteractionState) => {
        const c = colors(theme, variant, state);
        return [
          styles.base,
          { backgroundColor: c.fill, opacity: disabled ? 0.4 : c.opacity },
          focusVisible(state) && focusRing(theme),
          style,
        ];
      }}
    >
      {(state: InteractionState) => (
        <Text numberOfLines={1} style={[styles.label, { color: colors(theme, variant, state).text, fontSize: type.body }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: Radius.sm,
    height: 32,
    justifyContent: "center",
    paddingHorizontal: Space.lg,
  },
  label: { fontWeight: Weight.semibold },
});
