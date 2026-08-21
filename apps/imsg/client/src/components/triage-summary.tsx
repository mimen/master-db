import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTriageTheme } from "@/hooks/use-triage-theme";
import { queueAgeLabel } from "@/lib/queue-age";

export function TriageSummary({
  title,
  remaining,
  sweepCount,
  completed,
  oldestAt,
  onSweep,
}: {
  title: string;
  remaining: number;
  sweepCount: number;
  completed: number;
  oldestAt: number | null;
  onSweep?: () => void;
}): React.JSX.Element {
  const visual = useTriageTheme();
  return (
    <View style={styles.wrap}>
      <View style={styles.copy}>
        <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: visual.text }]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.meta, { color: visual.meta }]}>{completed} cleared today · {queueAgeLabel(oldestAt)}</Text>
      </View>
      <Text style={[styles.count, { color: visual.text }]}>{remaining}</Text>
      {onSweep ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Start sweep, ${sweepCount} conversations`}
          disabled={sweepCount === 0}
          onPress={onSweep}
          style={({ pressed }) => [styles.sweep, { backgroundColor: visual.controlFill }, sweepCount === 0 && styles.sweepDisabled, pressed && sweepCount > 0 && styles.sweepPressed]}
        >
          <Ionicons name="flash" size={14} color={visual.text} />
          <Text style={[styles.sweepText, { color: visual.text }]}>Sweep</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
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
  count: {
    fontSize: 18,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  sweep: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 4,
    height: 28,
    paddingHorizontal: 10,
  },
  sweepDisabled: { opacity: 0.35 },
  sweepPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.96 }],
  },
  sweepText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
