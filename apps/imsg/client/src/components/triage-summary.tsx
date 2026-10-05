import { StyleSheet, Text, View } from "react-native";
import { useTriageTheme } from "@/hooks/use-triage-theme";

export function TriageSummary({ title }: { title: string }): React.JSX.Element {
  const visual = useTriageTheme();
  return (
    <View style={styles.wrap}>
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: visual.text }]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    height: 28,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
    lineHeight: 24,
    minWidth: 0,
  },
});
