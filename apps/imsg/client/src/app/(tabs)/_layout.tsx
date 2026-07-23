import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";

/**
 * Real bottom tab bar on mobile: Messages and Contacts are equal primary
 * destinations, not one hidden behind the other. Hidden on wide/desktop
 * layouts, which use NavSwitcher (a segmented control) inside each screen
 * instead — a native-style tab bar reads oddly on a desktop-width web page.
 */
export default function TabsLayout() {
  const { wide } = useLayoutMode();
  const iosMobile = Platform.OS === "ios" && !wide;
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Mount both tabs at startup — first switch to Contacts otherwise
        // mounts the whole screen live (jarring full-screen flash).
        lazy: false,
        sceneStyle: { backgroundColor: wide ? theme.desk : theme.background },
        // Shorter bar with breathing room above the icons; the home-indicator
        // inset stays below the content instead of reading as dead space.
        tabBarStyle: wide
          ? styles.hiddenTabBar
          : iosMobile
            ? { height: 54 + insets.bottom, paddingTop: 8 }
            : undefined,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textSecondary,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Messages",
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubble-ellipses" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: "Contacts",
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  hiddenTabBar: {
    display: "none",
  },
});
