import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon";
import UserMultipleIcon from "@hugeicons/core-free-icons/UserMultipleIcon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native";
import { router, type Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/hooks/use-theme";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const BAR_HEIGHT = 58;
const BAR_GAP = 10;

/** Bottom padding a phone list needs so its last row scrolls clear of the bar. */
export const PHONE_TAB_BAR_CLEARANCE = BAR_HEIGHT + BAR_GAP + 40;

function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function Tab({
  icon,
  label,
  on = false,
  badge = 0,
  onPress,
}: {
  icon: IconSvgElement;
  label: string;
  on?: boolean;
  badge?: number;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={badge > 0 ? `${label}, ${badge} need a reply` : label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.tab, on && { backgroundColor: theme.rowSelected }]}
    >
      <HugeiconsIcon icon={icon} size={23} color={on ? theme.text : theme.icon} strokeWidth={1.6} />
      {badge > 0 ? (
        <View style={[styles.badge, { backgroundColor: theme.turn }]}>
          <Text style={[styles.badgeText, { color: theme.onTurn }]}>{badgeText(badge)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The phone's floating bubble bar: Messages (with the Needs reply count),
 * Contacts, Scheduled and Settings. It floats above the home indicator over a
 * fade, and the lists scroll under it.
 */
export function PhoneTabBar({ state, navigation, needsReply }: TabBarProps & { readonly needsReply: number }): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const route = state.routes[state.index]?.name;
  const bottom = Math.max(insets.bottom, 12);
  const fade = Platform.OS === "web"
    ? ({ backgroundImage: `linear-gradient(to bottom, ${theme.background}00, ${theme.background}F0 55%)` } as object)
    : null;
  const bar = Platform.OS === "web"
    ? ({ backgroundColor: theme.barBg, boxShadow: theme.barShadow, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" } as object)
    : { backgroundColor: theme.surface, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } };
  return (
    <View pointerEvents="box-none" style={[styles.host, { paddingBottom: bottom, paddingTop: 28 }, fade]}>
      <View role="tablist" style={[styles.bar, bar]}>
        <Tab icon={Message01Icon} label="Messages" on={route === "index"} badge={needsReply} onPress={() => navigation.navigate("index")} />
        <Tab icon={UserMultipleIcon} label="Contacts" on={route === "contacts"} onPress={() => navigation.navigate("contacts")} />
        <Tab icon={Clock01Icon} label="Scheduled" onPress={() => router.push("/scheduled")} />
        <Tab icon={Settings02Icon} label="Settings" onPress={() => router.push("/settings")} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { alignItems: "center", bottom: 0, left: 0, position: "absolute", right: 0 },
  bar: { borderRadius: 999, flexDirection: "row", gap: 4, height: BAR_HEIGHT, padding: 5 },
  tab: { alignItems: "center", borderRadius: 999, height: 48, justifyContent: "center", width: 68 },
  badge: { alignItems: "center", borderRadius: 999, height: 18, justifyContent: "center", left: 34, minWidth: 18, paddingHorizontal: 5, position: "absolute", top: 3 },
  badgeText: { fontSize: 11, fontVariant: ["tabular-nums"], fontWeight: "600" },
});
