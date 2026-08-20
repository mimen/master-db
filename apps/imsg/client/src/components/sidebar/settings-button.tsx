import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable } from "react-native";

import { useTheme } from "@/hooks/use-theme";

import { useChromeActions } from "./sidebar-chrome";

/**
 * The settings entry point (gear) shared by both sidebars — opens the
 * consolidated /settings modal (settings-content.tsx). Unlike the AI
 * suggestion popover it replaced, this renders unconditionally: the panel
 * covers more than AI now, so there's no single capability flag to gate the
 * button itself on (settings-content.tsx still gates its own AI section on
 * useAiStatus()?.suggestions).
 */
export function SettingsButton(): React.JSX.Element {
  const theme = useTheme();
  const chrome = useChromeActions();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Settings"
      onPress={() => router.push("/settings")}
      style={({ pressed }) => [chrome.button, pressed && { opacity: 0.55 }]}
    >
      <Ionicons name="settings-outline" size={chrome.iconSize} color={theme.accent} />
    </Pressable>
  );
}
