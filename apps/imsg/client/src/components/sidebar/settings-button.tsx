import { router } from "expo-router";

import { ChromeIconButton } from "./chrome-icon-button";

/**
 * The settings entry point (gear) shared by both sidebars — opens the
 * consolidated /settings modal (settings-content.tsx). Unlike the AI
 * suggestion popover it replaced, this renders unconditionally: the panel
 * covers more than AI now, so there's no single capability flag to gate the
 * button itself on (settings-content.tsx still gates its own AI section on
 * useAiStatus()?.suggestions).
 */
export function SettingsButton(): React.JSX.Element {
  return (
    <ChromeIconButton
      icon="settings-outline"
      accessibilityLabel="Settings"
      onPress={() => router.push("/settings")}
    />
  );
}
