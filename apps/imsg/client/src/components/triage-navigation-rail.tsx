import { router } from "expo-router";
import { useEffect, useState, type JSX } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { HugeiconsIcon } from "@hugeicons/react-native";
import {
  MessageSquareIcon,
  SentIcon,
  Settings01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";

import { useTriageTheme } from "@/hooks/use-triage-theme";
import { openScheduledPane } from "@/lib/scheduled-pane";
import { DESKTOP_RAIL_WIDTH } from "@/lib/desktop-coordinator/pane-admission";
import {
  isDesktopShell,
  NATIVE_TITLEBAR_INSET,
  watchDesktopFullscreen,
} from "@/lib/desktop-shell";

const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;
const DRAG = { dataSet: { tauriDragRegion: "" } } as object;

type RailIconName = "messages" | "contacts" | "scheduled" | "settings";

function RailIcon({ name, color }: { name: RailIconName; color: string }): JSX.Element {
  const icon = (() => {
    switch (name) {
      case "messages": return MessageSquareIcon;
      case "contacts": return UserGroupIcon;
      case "scheduled": return SentIcon;
      case "settings": return Settings01Icon;
    }
  })();
  return <HugeiconsIcon icon={icon} size={21} color={color} strokeWidth={1.8} />;
}

function Item({ icon, label, active = false, onPress }: { icon: RailIconName; label: string; active?: boolean; onPress: () => void }): JSX.Element {
  const [hovered, setHovered] = useState(false);
  const color = active ? "#FFFFFF" : "rgba(255,255,255,0.65)";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
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

/** The desktop shell's primary workspace navigation rail. */
export function TriageNavigationRail({
  destination = "messages",
}: {
  destination?: "messages" | "contacts";
}): JSX.Element {
  const visual = useTriageTheme();
  const shell = isDesktopShell();
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => watchDesktopFullscreen(setFullscreen), []);
  const titlebarInset = shell && !fullscreen ? NATIVE_TITLEBAR_INSET : 0;
  const onMessages = destination === "messages";
  const glass = Platform.OS === "web" ? ({
    backgroundColor: visual.rail,
    backdropFilter: "blur(40px) saturate(1.6)",
    WebkitBackdropFilter: "blur(40px) saturate(1.6)",
  } as object) : { backgroundColor: visual.rail };
  return (
    <View testID="triage-rail" style={[styles.rail, glass]} {...DRAG}>
      <View style={styles.top}>
        <View style={[styles.primary, { marginTop: titlebarInset }]}>
          <Item icon="messages" label="Messages" active={onMessages} onPress={() => { if (!onMessages) router.replace("/"); }} />
          <Item icon="contacts" label="Contacts" active={!onMessages} onPress={() => router.replace("/contacts")} />
          <Item icon="scheduled" label="Scheduled" onPress={() => {
            if (openScheduledPane()) return;
            router.push({ pathname: "/scheduled", params: { workspace: destination } });
          }} />
        </View>
      </View>
      <View style={styles.utility}>
        <Item icon="settings" label="Settings" onPress={() => router.push({ pathname: "/settings", params: { workspace: destination } })} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    justifyContent: "space-between",
    paddingBottom: 16,
    paddingTop: 16,
    width: DESKTOP_RAIL_WIDTH,
  },
  top: { alignItems: "center" },
  primary: { gap: 6 },
  utility: { alignItems: "center" },
  item: {
    alignItems: "center",
    borderRadius: 10,
    height: 40,
    justifyContent: "center",
    position: "relative",
    width: 40,
  },
  itemActive: { backgroundColor: "rgba(255,255,255,0.18)" },
  itemPressed: { transform: [{ scale: 0.96 }] },
});
