import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useTheme } from "@/hooks/use-theme";
import { useTriageTheme } from "@/hooks/use-triage-theme";

function ageLabel(timestamp: number | null): string {
  if (timestamp === null) return "no open conversations";
  const hours = Math.max(1, Math.floor((Date.now() - timestamp) / 3_600_000));
  return hours < 24 ? `oldest ${hours}h` : `oldest ${Math.floor(hours / 24)}d`;
}

export function TriageSummary({ title, remaining, sweepCount, completed, oldestAt, onSweep }: { title: string; remaining: number; sweepCount: number; completed: number; oldestAt: number | null; onSweep: () => void }): React.JSX.Element {
  const theme = useTheme();
  const visual = useTriageTheme();
  const total = remaining + completed;
  const progress = total === 0 ? 1 : completed / total;
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  return (
    <View style={styles.wrap}>
      <View style={styles.copy}>
        <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: visual.text }]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.meta, { color: visual.meta }]}>{completed} cleared today · {ageLabel(oldestAt)}</Text>
      </View>
      <View style={styles.ring}>
        <Svg width={34} height={34} viewBox="0 0 34 34">
          <Circle cx="17" cy="17" r={radius} fill="none" stroke={visual.ringTrack} strokeWidth="3.5" />
          <Circle cx="17" cy="17" r={radius} fill="none" stroke={theme.accent} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - progress)} rotation="-90" origin="17,17" />
        </Svg>
        <Text style={[styles.ringText, { color: visual.text }]}>{remaining}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Start sweep, ${sweepCount} conversations`}
        disabled={sweepCount === 0}
        onPress={onSweep}
        style={({ pressed }) => [styles.sweep, sweepCount === 0 && styles.sweepDisabled, pressed && sweepCount > 0 && styles.sweepPressed]}
      >
        <Ionicons name="flash" size={14} color="#FFFFFF" />
        <Text style={styles.sweepText}>Sweep {sweepCount}</Text>
      </Pressable>
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
  ring: {
    alignItems: "center",
    height: 34,
    justifyContent: "center",
    position: "relative",
    width: 34,
  },
  ringText: {
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
    position: "absolute",
  },
  sweep: {
    alignItems: "center",
    backgroundColor: "#1a1a1c",
    borderRadius: 14,
    flexDirection: "row",
    gap: 4,
    height: 28,
    paddingHorizontal: 11,
  },
  sweepDisabled: { opacity: 0.35 },
  sweepPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.96 }],
  },
  sweepText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
});
