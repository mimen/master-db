import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useWindowDimensions } from "react-native";
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
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: wide ? { display: "none" } : undefined,
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
