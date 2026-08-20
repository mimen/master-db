import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useTheme } from "@/hooks/use-theme";

function ageLabel(timestamp: number | null): string {
  if (timestamp === null) return "No open conversations";
  const hours = Math.max(1, Math.floor((Date.now() - timestamp) / 3_600_000));
  return hours < 24 ? `Oldest ${hours}h` : `Oldest ${Math.floor(hours / 24)}d`;
}
export function TriageSummary({ remaining, completed, oldestAt, onSweep }: { remaining: number; completed: number; oldestAt: number | null; onSweep: () => void }): React.JSX.Element {
  const theme = useTheme();
  const total = remaining + completed;
  const progress = total === 0 ? 1 : completed / total;
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  return <View style={[styles.wrap, { borderBottomColor: theme.divider }]}>
    <View style={styles.copy}>
      <Text numberOfLines={1} style={[styles.meta, { color: theme.textSecondary }]}>{completed} cleared today · {ageLabel(oldestAt)}</Text>
    </View>
    <View style={styles.ring}>
      <Svg width={36} height={36} viewBox="0 0 36 36">
        <Circle cx="18" cy="18" r={radius} fill="none" stroke={theme.divider} strokeWidth="3" />
        <Circle cx="18" cy="18" r={radius} fill="none" stroke={theme.accent} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - progress)} rotation="-90" origin="18,18" />
      </Svg>
      <Text style={[styles.ringText, { color: theme.text }]}>{remaining}</Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Start sweep" onPress={onSweep} style={({ pressed }) => [styles.sweep, { backgroundColor: theme.accent, opacity: pressed ? 0.75 : 1 }]}><Ionicons name="flash" size={12} color={theme.onAccent} /><Text style={[styles.sweepText, { color: theme.onAccent }]}>Sweep {remaining}</Text></Pressable>
  </View>;
}
const styles = StyleSheet.create({
  wrap: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 9, paddingHorizontal: 12, paddingVertical: 10 },
  copy: { flex: 1, minWidth: 0 },
  meta: { fontSize: 12, lineHeight: 16 },
  ring: { alignItems: "center", height: 36, justifyContent: "center", position: "relative", width: 36 },
  ringText: { fontSize: 10, fontVariant: ["tabular-nums"], fontWeight: "700", position: "absolute" },
  sweep: { alignItems: "center", borderRadius: 9, flexDirection: "row", gap: 4, paddingHorizontal: 9, paddingVertical: 7 },
  sweepText: { fontSize: 11, fontWeight: "700" },
});
