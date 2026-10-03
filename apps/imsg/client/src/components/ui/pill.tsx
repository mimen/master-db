import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from "react-native";

import { Radius, Space, Weight } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";

import { focusRing, focusVisible, type InteractionState, type ThemeColors } from "./interaction";

export type PillTone = "neutral" | "accent" | "success";
export type PillSize = "sm" | "md";

export interface PillProps {
  readonly label: string;
  readonly tone?: PillTone;
  readonly size?: PillSize;
  /** A selected pill inverts to a solid fill. */
  readonly selected?: boolean;
  readonly icon?: ReactNode;
  /** Without onPress the pill is a static label, not a button. */
  readonly onPress?: (event: GestureResponderEvent) => void;
  readonly style?: StyleProp<ViewStyle>;
}

const HEIGHT: Record<PillSize, number> = { sm: 24, md: 32 };

function toneColors(theme: ThemeColors, tone: PillTone, selected: boolean, state: InteractionState): { fill: string; text: string } {
  const solid = tone === "neutral" ? theme.text : tone === "accent" ? theme.accent : theme.success;
  if (selected) return { fill: solid, text: tone === "accent" ? theme.onAccent : theme.background };
  // The pill already rests one step up, so hover and press go to the top step.
  const active = state.hovered || state.pressed;
  if (tone === "neutral") return { fill: active ? theme.backgroundSelected : theme.backgroundElement, text: theme.text };
  if (tone === "accent") return { fill: active ? theme.backgroundSelected : theme.accentTint, text: theme.accent };
  return { fill: active ? theme.backgroundSelected : theme.backgroundElement, text: theme.success };
}

/** A fully rounded chip: filters, suggestions, status. */
export function Pill({ label, tone = "neutral", size = "md", selected = false, icon, onPress, style }: PillProps): React.JSX.Element {
  const theme = useTheme();
  const type = useTypeRamp();
  const body = (state: InteractionState) => {
    const c = toneColors(theme, tone, selected, state);
    return {
      container: [
        styles.base,
        { height: HEIGHT[size], paddingHorizontal: size === "sm" ? Space.md : Space.lg, backgroundColor: c.fill },
        focusVisible(state) && focusRing(theme),
        style,
      ],
      text: (
        <>
          {icon}
          <Text numberOfLines={1} style={[styles.label, { color: c.text, fontSize: size === "sm" ? type.secondary : type.body }]}>
            {label}
          </Text>
        </>
      ),
    };
  };

  if (!onPress) {
    const { container, text } = body({ pressed: false, hovered: false });
    return <View style={container}>{text}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={(state: InteractionState) => body(state).container}
    >
      {(state: InteractionState) => body(state).text}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: Radius.full,
    flexDirection: "row",
    gap: Space.xs,
  },
  label: { fontWeight: Weight.semibold },
});
