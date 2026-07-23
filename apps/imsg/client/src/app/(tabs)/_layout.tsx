import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Platform, StyleSheet, useWindowDimensions } from "react-native";
import { useTheme } from "@/hooks/use-theme";

/**
 * Real bottom tab bar on mobile: Messages and Contacts are equal primary
 * destinations, not one hidden behind the other. Hidden on wide/desktop
 * layouts, which use NavSwitcher (a segmented control) inside each screen
 * instead — a native-style tab bar reads oddly on a desktop-width web page.
 */
export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const iosMobile = Platform.OS === "ios" && !wide;
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Mount both tabs at startup — first switch to Contacts otherwise
        // mounts the whole screen live (jarring full-screen flash).
        lazy: false,
        sceneStyle: { backgroundColor: wide ? theme.desk : theme.background },
        tabBarStyle: wide ? styles.hiddenTabBar : undefined,
        tabBarIconStyle: iosMobile ? styles.mobileTabIcon : undefined,
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
  mobileTabIcon: {
    marginTop: -3,
  },
});
