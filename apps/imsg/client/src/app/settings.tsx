import { router, Stack } from "expo-router";
import { Pressable, Text } from "react-native";
import { SettingsContent } from "@/components/settings-content";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { Space } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import { goBackOrHome } from "@/lib/back-navigation";

export default function SettingsScreen(): React.JSX.Element | null {
  const { wide } = useLayoutMode();
  const theme = useTheme();
  if (wide) return null;
  return (
    <>
      {/* A modal sheet with no visible control reads as a trap; swipe-down alone is not discoverable. */}
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={() => goBackOrHome(router)} hitSlop={8} style={{ paddingHorizontal: Space.xl }}>
              <Text style={{ color: theme.accent, fontSize: 17, fontWeight: "600" }}>Done</Text>
            </Pressable>
          ),
        }}
      />
      <SettingsContent />
    </>
  );
}
