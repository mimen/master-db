import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { useTriageTheme } from "@/hooks/use-triage-theme";

export function TriageBatchBanner({ count, batchable, onSweep }: { count: number; batchable: boolean; onSweep: () => void }): React.JSX.Element {
  const theme = useTheme();
  const visual = useTriageTheme();
  return (
    <View style={[styles.banner, { backgroundColor: "rgba(0,122,255,0.07)" }]}>
      <Ionicons name="sparkles" size={15} color={theme.accent} />
      <Text numberOfLines={2} style={[styles.copy, { color: visual.text }]}>{batchable ? `${count} of these are quick clears — handle them in one pass?` : `Clear the queue one conversation at a time.`}</Text>
      <Pressable onPress={onSweep} style={styles.action}>
        <Text style={[styles.actionText, { color: theme.accent }]}>Sweep {count}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { alignItems: "center", borderRadius: 10, flexDirection: "row", gap: 8, marginBottom: 6, paddingHorizontal: 10, paddingVertical: 8 },
  copy: { flex: 1, fontSize: 12, lineHeight: 15 },
  action: { paddingHorizontal: 3, paddingVertical: 3 },
  actionText: { fontSize: 12, fontWeight: "600" },
});
