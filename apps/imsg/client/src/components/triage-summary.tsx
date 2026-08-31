import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { HoverFillButton } from "./hover-fill-button";
import { useTriageTheme } from "@/hooks/use-triage-theme";
import { queueAgeLabel } from "@/lib/queue-age";

export function TriageSummary({
  title,
  sweepCount,
  completed,
  oldestAt,
  onSweep,
}: {
  title: string;
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
        <Text numberOfLines={1} style={[styles.meta, { color: visual.meta }]}>{completed} settled today · {queueAgeLabel(oldestAt)}</Text>
      </View>
      {onSweep ? (
        <HoverFillButton
          accessibilityLabel={`Start sweep, ${sweepCount} conversations`}
          disabled={sweepCount === 0}
          onPress={onSweep}
          restFill={visual.controlFill}
          hoverFill={visual.controlFillHover}
          style={[styles.sweep, sweepCount === 0 && styles.sweepDisabled]}
        >
          <Ionicons name="flash" size={14} color={visual.text} />
          <Text style={[styles.sweepText, { color: visual.text }]}>Sweep</Text>
        </HoverFillButton>
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
  sweep: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 4,
    height: 28,
    paddingHorizontal: 10,
  },
  sweepDisabled: { opacity: 0.35 },
  sweepText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
