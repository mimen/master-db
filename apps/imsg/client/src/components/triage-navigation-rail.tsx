import type { StateCounts, StateFilter } from "@shared/types";
import { router } from "expo-router";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useEffect, useState } from "react";
import Svg, { Path } from "react-native-svg";
import { useTriageTheme } from "@/hooks/use-triage-theme";
import {
  isDesktopShell,
  NATIVE_TITLEBAR_INSET,
  watchDesktopFullscreen,
} from "@/lib/desktop-shell";
import { requestInboxFilter } from "@/lib/inbox-filter";
import { openScheduledPane } from "@/lib/scheduled-pane";
import { openSettingsPane } from "@/lib/settings-pane";

const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;
const DRAG = { dataSet: { tauriDragRegion: "" } } as object;

type RailIconName = "inbox" | "waiting" | "messages" | "contacts" | "scheduled" | "settings";

function RailIcon({ name, color }: { name: RailIconName; color: string }): React.JSX.Element {
  const paths: readonly string[] = (() => {
    switch (name) {
      case "inbox":
        return ["M4.5 5.5h15l-1.8 12h-11.4l-1.8-12Z", "M5.4 12.5h4.1l1.4 2h2.2l1.4-2h4.1"];
      case "waiting":
        return ["M6 3.5h12M6 20.5h12", "M7.5 3.5v3c0 2.1 1.6 3.5 3.2 5.5-1.6 2-3.2 3.4-3.2 5.5v3", "M16.5 3.5v3c0 2.1-1.6 3.5-3.2 5.5 1.6 2 3.2 3.4 3.2 5.5v3"];
      case "messages":
        return ["M5.5 6.5h9a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4H10l-3.8 2.5.8-2.9a4 4 0 0 1-1.5-3.1v-2.5a4 4 0 0 1 4-4Z", "M7 5a4 4 0 0 1 3.5-2h5a4 4 0 0 1 4 4v2.5c0 .9-.3 1.8-.8 2.5"];
      case "contacts":
        return ["M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", "M16.5 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z", "M3.5 19v-1.5a4.5 4.5 0 0 1 9 0V19h-9Z", "M13.5 14.2a4 4 0 0 1 7 2.6V19h-6"];
      case "scheduled":
        return ["M4 4.5 20 12 4 19.5l2-6 8-1.5-8-1.5-2-6Z"];
      case "settings":
        return ["M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.6a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.6a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"];
    }
  })();
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
      {paths.map((path) => (
        <Path
          key={path}
          d={path}
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

function Item({ icon, label, active = false, count, onPress }: { icon: RailIconName; label: string; active?: boolean; count?: number; onPress: () => void }): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  const color = active ? "#FFFFFF" : "rgba(255,255,255,0.65)";
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
      <RailIcon name={icon} color={color} />
    </Pressable>
  );
}

/**
 * The desktop rail — the app's primary navigation, rendered by BOTH sidebars
 * so the shell is identical on Messages and Contacts. Contacts has no local
 * filter state, so its inbox items publish through the inbox-filter bus and
 * then navigate to Messages (both tabs stay mounted, so the listener is live).
 */
export function TriageNavigationRail({
  state,
  counts,
  onStateChange,
  destination = "messages",
}: {
  state?: StateFilter;
  counts?: StateCounts | null;
  onStateChange?: (state: StateFilter) => void;
  destination?: "messages" | "contacts";
}): React.JSX.Element {
  const visual = useTriageTheme();
  const shell = isDesktopShell();
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => watchDesktopFullscreen(setFullscreen), []);
  const titlebarInset = shell && !fullscreen ? NATIVE_TITLEBAR_INSET : 0;
  const onMessages = destination === "messages";
  const goToState = (next: StateFilter): void => {
    if (onMessages) {
      onStateChange?.(next);
      return;
    }
    requestInboxFilter(next);
    router.push("/");
  };
  const glass = Platform.OS === "web" ? ({
    backgroundColor: visual.rail,
    backdropFilter: "blur(40px) saturate(1.6)",
    WebkitBackdropFilter: "blur(40px) saturate(1.6)",
  } as object) : { backgroundColor: visual.rail };
  return (
    <View testID="triage-rail" style={[styles.rail, glass]} {...DRAG}>
      <View style={styles.top}>
        <View style={[styles.primary, { marginTop: titlebarInset }]}>
          <Item icon="inbox" label="Needs reply" count={counts?.unresponded} active={onMessages && state === "unresponded"} onPress={() => goToState("unresponded")} />
          <Item icon="waiting" label="Waiting" active={onMessages && state === "waiting"} onPress={() => goToState("waiting")} />
          <Item icon="messages" label="All messages" active={onMessages && state === "all"} onPress={() => goToState("all")} />
          <Item icon="contacts" label="Contacts" active={!onMessages} onPress={() => router.push("/(tabs)/contacts")} />
          <Item icon="scheduled" label="Scheduled" onPress={() => { if (!openScheduledPane()) router.push("/scheduled"); }} />
        </View>
      </View>
      <View style={styles.utility}>
        <Item icon="settings" label="Settings" onPress={() => { if (!openSettingsPane()) router.push("/settings"); }} />
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
  },
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
});
