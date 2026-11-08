import type { PlatformBadge } from "@shared/platform-profile";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";

/** The route's dot and name shown beside a handle: blue iMessage, green SMS. */
export function ServiceLabel({ badge, size = 11.5 }: { readonly badge: PlatformBadge; readonly size?: number }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <ServiceDot badge={badge} />
      <Text style={[styles.label, { color: theme.textSecondary, fontSize: size }]}>{badge.label}</Text>
    </View>
  );
}

export function ServiceDot({ badge, size = 7 }: { readonly badge: PlatformBadge; readonly size?: number }): React.JSX.Element {
  const theme = useTheme();
  return <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme[badge.color] }]} />;
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", gap: 5 },
  dot: { flexShrink: 0 },
  label: { fontWeight: "500" },
});
