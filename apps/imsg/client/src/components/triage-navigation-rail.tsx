import { Ionicons } from "@expo/vector-icons";
import type { StateCounts, StateFilter } from "@shared/types";
import { router } from "expo-router";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { useTriageTheme } from "@/hooks/use-triage-theme";
import { isDesktopShell } from "@/lib/desktop-shell";
import { openScheduledPane } from "@/lib/scheduled-pane";
import { openSettingsPane } from "@/lib/settings-pane";
import { DesktopWindowControls } from "./desktop-window-controls";

const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;
const DRAG = { dataSet: { tauriDragRegion: "" } } as object;

function Item({ icon, label, active = false, count, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; active?: boolean; count?: number; onPress: () => void }): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={onPress}
      style={({ pressed }) => [styles.item, (active || hovered || pressed) && styles.itemActive, pressed && styles.itemPressed]}
      {...NO_DRAG}
    >
      <Ionicons name={icon} size={21} color={active ? "#FFFFFF" : "rgba(255,255,255,0.65)"} />
      {count !== undefined && count > 0 ? (
        <Text style={styles.count}>{count > 99 ? "99+" : count}</Text>
      ) : null}
    </Pressable>
  );
}

export function TriageNavigationRail({ state, counts, onStateChange }: { state: StateFilter; counts: StateCounts | null; onStateChange: (state: StateFilter) => void }): React.JSX.Element {
  const visual = useTriageTheme();
  const shell = isDesktopShell();
  const glass = Platform.OS === "web" ? ({
    backgroundColor: visual.rail,
    backdropFilter: "blur(40px) saturate(1.6)",
    WebkitBackdropFilter: "blur(40px) saturate(1.6)",
  } as object) : { backgroundColor: visual.rail };
  return (
    <View testID="triage-rail" style={[styles.rail, glass]} {...DRAG}>
      <View style={styles.top}>
        <DesktopWindowControls />
        <View style={[styles.primary, !shell && styles.primaryWeb]}>
          <Item icon="file-tray-full-outline" label="Needs reply" count={counts?.unresponded} active={state === "unresponded"} onPress={() => onStateChange("unresponded")} />
          <Item icon="hourglass-outline" label="Waiting" active={state === "waiting"} onPress={() => onStateChange("waiting")} />
          <Item icon="chatbubbles-outline" label="All messages" active={state === "all"} onPress={() => onStateChange("all")} />
          <Item icon="people-outline" label="Contacts" onPress={() => router.push("/(tabs)/contacts")} />
          <Item icon="send-outline" label="Scheduled" onPress={() => { if (!openScheduledPane()) router.push("/scheduled"); }} />
        </View>
      </View>
      <View style={styles.utility}>
        <Item icon="settings-outline" label="Settings" onPress={() => { if (!openSettingsPane()) router.push("/settings"); }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    justifyContent: "space-between",
    paddingBottom: 16,
    paddingTop: 16,
    width: 64,
  },
  top: {
    alignItems: "center",
  },
  primary: {
    gap: 6,
    marginTop: 22,
  },
  primaryWeb: { marginTop: 0 },
  utility: {
    alignItems: "center",
  },
  item: {
    alignItems: "center",
    borderRadius: 10,
    height: 40,
    justifyContent: "center",
    position: "relative",
    width: 40,
  },
  itemActive: {
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  itemPressed: {
    transform: [{ scale: 0.96 }],
  },
  count: {
    backgroundColor: "#FF453A",
    borderRadius: 9,
    color: "#FFFFFF",
    fontSize: 10,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
    height: 17,
    lineHeight: 17,
    minWidth: 17,
    overflow: "hidden",
    paddingHorizontal: 4,
    position: "absolute",
    right: -4,
    textAlign: "center",
    top: -4,
  },
});
