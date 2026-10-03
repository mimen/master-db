import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { Space, Weight } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";

export const PANE_HEADER_HEIGHT = 52;

export interface PaneHeaderProps {
  readonly title: string;
  /** Back or close control, left of the title. */
  readonly leading?: ReactNode;
  /** IconButtons, right-aligned. */
  readonly actions?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

/** The 52pt bar on top of every pane: title 15/600 at the pane gutter, divider below. */
export function PaneHeader({ title, leading, actions, style }: PaneHeaderProps): React.JSX.Element {
  const theme = useTheme();
  const type = useTypeRamp();
  return (
    <View testID="pane-header" style={[styles.base, { borderBottomColor: theme.divider }, style]}>
      {leading}
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[styles.title, { color: theme.text, fontSize: type.title }]}
      >
        {title}
      </Text>
      {actions !== undefined && <View style={styles.actions}>{actions}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: Space.md,
    height: PANE_HEADER_HEIGHT,
    paddingHorizontal: Space.gutter,
  },
  title: { flex: 1, fontWeight: Weight.semibold },
  actions: { alignItems: "center", flexDirection: "row", gap: Space.xs },
});
