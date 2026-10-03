import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from "react-native";

import { Radius, Space, Weight } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";

import { focusRing, focusVisible, stepFill, type InteractionState } from "./interaction";

export type RowDensity = "compact" | "regular";

export interface RowProps {
  readonly title: string;
  readonly subtitle?: string;
  /** Avatar or icon, left of the text. */
  readonly leading?: ReactNode;
  /** Timestamp, badge or chevron, right of the text. */
  readonly trailing?: ReactNode;
  readonly density?: RowDensity;
  readonly selected?: boolean;
  readonly onPress?: (event: GestureResponderEvent) => void;
  readonly style?: StyleProp<ViewStyle>;
}

export const ROW_HEIGHT: Record<RowDensity, number> = { compact: 44, regular: 62 };

/** The list row every pane uses: leading, title over subtitle, trailing. */
export function Row({ title, subtitle, leading, trailing, density = "regular", selected = false, onPress, style }: RowProps): React.JSX.Element {
  const theme = useTheme();
  const type = useTypeRamp();
  const content = (
    <>
      {leading}
      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.title, { color: theme.text, fontSize: type.body }]}>{title}</Text>
        {subtitle !== undefined && (
          <Text numberOfLines={1} style={{ color: theme.textSecondary, fontSize: type.secondary }}>{subtitle}</Text>
        )}
      </View>
      {trailing}
    </>
  );
  const frame = [styles.base, { minHeight: ROW_HEIGHT[density] }];

  if (!onPress) {
    return <View style={[...frame, selected && { backgroundColor: theme.backgroundSelected }, style]}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={(state: InteractionState) => [
        ...frame,
        { backgroundColor: selected ? theme.backgroundSelected : stepFill(theme, state, "transparent") },
        focusVisible(state) && focusRing(theme),
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: Radius.md,
    flexDirection: "row",
    gap: Space.lg,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
  },
  text: { flex: 1, gap: Space.xxs, minWidth: 0 },
  title: { fontWeight: Weight.semibold },
});
