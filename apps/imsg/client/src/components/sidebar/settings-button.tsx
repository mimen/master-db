import { router } from "expo-router";

import { useLayoutMode } from "@/hooks/use-layout-mode";
import { openSettingsPane } from "@/lib/settings-pane";
import { ChromeIconButton } from "./chrome-icon-button";

/**
 * The settings entry point (gear) shared by both sidebars — opens the
 * consolidated settings surface (settings-content.tsx). On the wide/desktop
 * layout it opens as a right-hand pane inside the existing shell (the list
 * and thread stay put); on mobile it falls back to the /settings modal.
 *
 * Renders unconditionally: the panel covers more than AI now, so there's no
 * single capability flag to gate the button itself on (settings-content.tsx
 * still gates its own AI section on useAiStatus()?.suggestions).
 */
export function SettingsButton(): React.JSX.Element {
  const { wide } = useLayoutMode();
  return (
    <ChromeIconButton
      icon="settings-outline"
      accessibilityLabel="Settings"
      onPress={() => {
        if (wide && openSettingsPane()) return;
        router.push("/settings");
      }}
    />
  );
}
