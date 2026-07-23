import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/use-theme";
import { Spacing } from "@/constants/theme";

export interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  iconSize?: number;
  /** A string renders with the default centered/secondary styling; pass a
   * node (e.g. a multi-line <Text> with its own lineHeight) for a site whose
   * copy needs custom typography. */
  message: ReactNode;
  /** Extra content below the message — an action button, an input, etc. */
  children?: ReactNode;
  /** Per-surface layout nudges (paddingTop, paddingHorizontal, gap) that
   * fall outside this component's own defaults. */
  style?: StyleProp<ViewStyle>;
}

/** Centered icon + message for "nothing here yet" panes. */
export function EmptyState({ icon, iconSize = 28, message, children, style }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={[styles.container, style]}>
      {icon && <Ionicons name={icon} size={iconSize} color={theme.textSecondary} />}
      {typeof message === "string" ? (
        <Text style={[styles.message, { color: theme.textSecondary }]}>{message}</Text>
      ) : (
        message
      )}
      {children}
    </View>
  );
}

export interface CenteredSpinnerProps {
  style?: StyleProp<ViewStyle>;
}

/** Full-bleed centered ActivityIndicator for a pane's initial load. */
export function CenteredSpinner({ style }: CenteredSpinnerProps) {
  return (
    <View style={[styles.spinner, style]}>
      <ActivityIndicator />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flex: 1,
    // The dominant gap across empty-state call sites; has no visual effect
    // on icon-less/childless usages since RN gap only spaces siblings.
    gap: Spacing.two + 1,
    justifyContent: "center",
  },
  message: {
    fontSize: 15,
  },
  spinner: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
});
