import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { Space } from "@/constants/tokens";
import { TriageGeometry } from "@/constants/triage-theme";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";
import { toolbarTitle } from "@/lib/header-font";

export interface PaneHeaderProps {
  readonly title: string;
  /** Quieter text after the title, such as the conversation a pane is about. It truncates before the title does. */
  readonly detail?: string;
  /** Back or close control, or an identity glyph, left of the title. */
  readonly leading?: ReactNode;
  /** IconButtons, right-aligned. */
  readonly actions?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

/** The bar on top of every pane, the thread header's height and title face so the two read as one toolbar. */
export function PaneHeader({ title, detail, leading, actions, style }: PaneHeaderProps): React.JSX.Element {
  const theme = useTheme();
  const type = useTypeRamp();
  return (
    <View testID="pane-header" style={[styles.base, { borderBottomColor: theme.divider }, style]}>
      {leading}
      <View style={styles.titles}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[styles.title, { color: theme.text, flexShrink: detail ? 0 : 1 }]}
        >
          {title}
        </Text>
        {detail ? <Text numberOfLines={1} style={[styles.detail, { color: theme.textTertiary, fontSize: type.body }]}>{detail}</Text> : null}
      </View>
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
    height: TriageGeometry.threadHeaderHeight,
    paddingHorizontal: Space.gutter,
  },
  titles: { alignItems: "baseline", flex: 1, flexDirection: "row", gap: Space.sm, minWidth: 0 },
  title: toolbarTitle,
  detail: { flexShrink: 1 },
  actions: { alignItems: "center", flexDirection: "row", gap: Space.xs },
});
