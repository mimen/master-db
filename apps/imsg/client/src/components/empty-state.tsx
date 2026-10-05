import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/use-theme";
import { useType } from "@/hooks/use-type";
import { Spacing } from "@/constants/theme";

export interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  iconSize?: number;
  iconColor?: string;
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
export function EmptyState({ icon, iconSize = 28, iconColor, message, children, style }: EmptyStateProps) {
  const theme = useTheme();
  const type = useType();
  return (
    <View style={[styles.container, style]}>
      {icon && <Ionicons name={icon} size={iconSize} color={iconColor ?? theme.textSecondary} />}
      {typeof message === "string" ? (
        <Text style={{ color: theme.textSecondary, fontSize: type.body }}>{message}</Text>
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

// Most loads finish inside this window; holding the spinner back keeps a fast load from flashing it.
const SPINNER_DELAY_MS = 400;

/** Full-bleed centered ActivityIndicator for a pane's initial load. */
export function CenteredSpinner({ style }: CenteredSpinnerProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return <View style={[styles.spinner, style]}>{shown && <ActivityIndicator />}</View>;
}

export interface ErrorStateProps {
  title: string;
  message: string;
  onRetry: () => void;
}

/** A load that failed: what failed, the one thing to check, and Try again as the only action. */
export function ErrorState({ title, message, onRetry }: ErrorStateProps) {
  const c = useTheme();
  return (
    <View style={styles.error}>
      <Ionicons name="alert-circle-outline" size={26} color={c.destructive} />
      <Text role="heading" style={[styles.errorTitle, { color: c.text }]}>{title}</Text>
      <Text style={[styles.errorMessage, { color: c.textSecondary }]}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({ hovered, pressed }) => [styles.retry, { backgroundColor: hovered || pressed ? c.field : c.surface, borderColor: c.dividerStrong }]}
      >
        <Ionicons name="refresh" size={14} color={c.text} />
        <Text style={[styles.retryText, { color: c.text }]}>Try again</Text>
      </Pressable>
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
  spinner: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  error: { alignItems: "center", flex: 1, gap: 6, justifyContent: "center", paddingHorizontal: 22 },
  errorTitle: { fontSize: 13.5, fontWeight: "600", textAlign: "center" },
  errorMessage: { fontSize: 12.5, lineHeight: 17.5, maxWidth: 300, textAlign: "center" },
  retry: { alignItems: "center", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 6, height: 30, marginTop: 8, paddingHorizontal: 12 },
  retryText: { fontSize: 12.5, fontWeight: "600" },
});
