import { StyleSheet, Text, View } from "react-native";
import { useTriageTheme } from "@/hooks/use-triage-theme";

/**
 * Contacts' desk-header summary — the same title/meta block as TriageSummary
 * so both sidebars read as one surface, without the triage-only progress ring
 * and sweep button (Contacts is a directory, not a queue).
 */
export function ContactsSummary({
  total,
  favorites,
}: {
  total: number | null;
  favorites: number;
}): React.JSX.Element {
  const visual = useTriageTheme();
  const meta =
    total === null
      ? "Loading…"
      : `${total} ${total === 1 ? "person" : "people"}${favorites > 0 ? ` · ${favorites} favorite${favorites === 1 ? "" : "s"}` : ""}`;
  return (
    <View style={styles.wrap}>
      <View style={styles.copy}>
        <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: visual.text }]}>
          Contacts
        </Text>
        <Text numberOfLines={1} style={[styles.meta, { color: visual.meta }]}>
          {meta}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Matches TriageSummary's geometry so the two headers align line-for-line.
  wrap: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 34,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
    lineHeight: 24,
  },
  meta: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
});
