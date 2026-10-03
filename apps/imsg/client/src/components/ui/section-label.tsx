import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

import { Space, Weight } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";

export interface SectionLabelProps {
  /** Sentence case ("Shared media"), never ALL CAPS. */
  readonly children: string;
  readonly style?: StyleProp<TextStyle>;
}

/** The heading over a group of rows: secondary size, semibold, secondary color. */
export function SectionLabel({ children, style }: SectionLabelProps): React.JSX.Element {
  const theme = useTheme();
  const type = useTypeRamp();
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={1}
      style={[styles.base, { color: theme.textSecondary, fontSize: type.secondary }, style]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontWeight: Weight.semibold,
    paddingBottom: Space.xs,
    paddingHorizontal: Space.gutter,
    paddingTop: Space.lg,
  },
});
