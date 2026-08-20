import { Ionicons } from "@expo/vector-icons";
import type { StateCounts, StateFilter } from "@shared/types";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { isDesktopShell } from "@/lib/desktop-shell";

function Item({ icon, label, active = false, count, countAccent = false, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; active?: boolean; count?: number; countAccent?: boolean; onPress: () => void }): React.JSX.Element {
  return <Pressable accessibilityRole="button" accessibilityLabel={count === undefined ? label : `${label}, ${count}`} onPress={onPress} style={({ pressed }) => [styles.item, (active || pressed) && styles.itemActive]}>
    <Ionicons name={icon} size={19} color={active ? "#FFFFFF" : "#C7C7CC"} />
    <Text numberOfLines={1} style={[styles.label, { color: active ? "#FFFFFF" : "#C7C7CC" }]}>{label}</Text>
    {count !== undefined && count > 0 ? <Text style={[styles.count, countAccent && styles.countAccent]}>{count > 99 ? "99+" : count}</Text> : null}
  </Pressable>;
}

export function TriageNavigationRail({ state, counts, onStateChange }: { state: StateFilter; counts: StateCounts | null; onStateChange: (state: StateFilter) => void }): React.JSX.Element {
  const shell = isDesktopShell();
  return <View style={[styles.rail, shell && styles.railShell]}>
    <View style={styles.primary}>
      <Item icon="arrow-undo-outline" label="Needs" count={counts?.unresponded} countAccent active={state === "unresponded"} onPress={() => onStateChange("unresponded")} />
      <Item icon="time-outline" label="Waiting" active={state === "waiting"} onPress={() => onStateChange("waiting")} />
      <Item icon="chatbubbles-outline" label="All" active={state === "all"} onPress={() => onStateChange("all")} />
    </View>
    <View style={styles.utility}>
      <Item icon="people-outline" label="Contacts" onPress={() => router.push("/(tabs)/contacts")} />
      <Item icon="calendar-outline" label="Scheduled" onPress={() => router.push("/scheduled")} />
      <Item icon="settings-outline" label="Settings" onPress={() => router.push("/settings")} />
    </View>
  </View>;
}
const styles = StyleSheet.create({
  rail: { backgroundColor: "#2C2C2E", borderRightColor: "rgba(255,255,255,0.08)", borderRightWidth: StyleSheet.hairlineWidth, justifyContent: "space-between", paddingBottom: 7, paddingTop: 8, width: 64 },
  railShell: { paddingTop: 54 },
  primary: { gap: 3 }, utility: { borderTopColor: "rgba(255,255,255,0.08)", borderTopWidth: StyleSheet.hairlineWidth, gap: 1, paddingTop: 6 },
  item: { alignItems: "center", borderRadius: 9, gap: 2, marginHorizontal: 5, minHeight: 51, paddingHorizontal: 2, paddingVertical: 6, position: "relative" },
  itemActive: { backgroundColor: "rgba(255,255,255,0.16)" },
  label: { fontSize: 9, fontWeight: "600", letterSpacing: -0.1 },
  count: { color: "#FFFFFF", fontSize: 10, fontVariant: ["tabular-nums"], fontWeight: "700", lineHeight: 17, position: "absolute", right: 2, top: 1 },
  countAccent: { backgroundColor: "#FF453A", borderRadius: 9, minWidth: 17, overflow: "hidden", paddingHorizontal: 3, textAlign: "center" },
});
