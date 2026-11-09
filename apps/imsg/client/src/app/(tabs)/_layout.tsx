import { Tabs } from "expo-router";
import { Platform, StyleSheet } from "react-native";

import { PhoneTabBar } from "@/components/phone-tab-bar";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { useBadgeCount } from "@/lib/badge-count";
import { WORKSPACES } from "@/lib/workspaces";

/**
 * Phone navigation: each workspace is a tab screen, Scheduled and
 * Settings open as routes from the same floating bar. The persistent desktop
 * shell owns wide navigation, so no bar renders there.
 */
export default function TabsLayout() {
  const { wide } = useLayoutMode();
  const theme = useTheme();
  // The badge every surface shows: Today's "to go".
  const needsReply = useBadgeCount() ?? 0;

  return (
    <Tabs
      tabBar={(props) => (wide ? null : <PhoneTabBar {...props} needsReply={needsReply} />)}
      screenOptions={({ navigation }) => ({
        headerShown: false,
        // Mount every tab at startup — first switch to Contacts otherwise
        // mounts the whole screen live (jarring full-screen flash).
        lazy: false,
        // On web the inactive scene only drops to zIndex -1, so it still paints in the viewport and
        // Contacts filling in at boot counts as layout shift. Hidden, not display:none, which would
        // reset the Messages list's scroll offset on every tab switch.
        sceneStyle: [{ backgroundColor: theme.background }, Platform.OS === "web" && !navigation.isFocused() && styles.hidden],
        // The bar floats over the scene; the lists pad themselves clear of it.
        tabBarStyle: styles.floating,
      })}
    >
      {WORKSPACES.map((workspace) => <Tabs.Screen key={workspace.id} name={workspace.tab} options={{ title: workspace.label }} />)}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  floating: { position: "absolute" },
  hidden: { visibility: "hidden" } as object,
});
