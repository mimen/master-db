import { Tabs } from "expo-router";
import { StyleSheet } from "react-native";

import { PhoneTabBar } from "@/components/phone-tab-bar";
import { useChats } from "@/hooks/use-chats";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { DEFAULT_INBOX_FILTERS } from "@/lib/inbox-model";

/**
 * Phone navigation: Messages and Contacts are tab screens, Scheduled and
 * Settings open as routes from the same floating bar. The persistent desktop
 * shell owns wide navigation, so no bar renders there.
 */
export default function TabsLayout() {
  const { wide } = useLayoutMode();
  const theme = useTheme();
  const { counts } = useChats("unresponded", DEFAULT_INBOX_FILTERS.type);
  const needsReply = counts?.unresponded ?? 0;

  return (
    <Tabs
      tabBar={(props) => (wide ? null : <PhoneTabBar {...props} needsReply={needsReply} />)}
      screenOptions={{
        headerShown: false,
        // Mount both tabs at startup — first switch to Contacts otherwise
        // mounts the whole screen live (jarring full-screen flash).
        lazy: false,
        sceneStyle: { backgroundColor: theme.background },
        // The bar floats over the scene; the lists pad themselves clear of it.
        tabBarStyle: styles.floating,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Messages" }} />
      <Tabs.Screen name="contacts" options={{ title: "Contacts" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  floating: { position: "absolute" },
});
