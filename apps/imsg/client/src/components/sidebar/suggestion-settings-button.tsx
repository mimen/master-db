import { Ionicons } from "@expo/vector-icons";
import { useRef } from "react";
import { Pressable, type View } from "react-native";

import { useAiStatus } from "@/hooks/use-ai";
import { useTheme } from "@/hooks/use-theme";
import { useActionSheet } from "@/lib/action-sheet";
import { setSuggestionMode, useSuggestionMode, type SuggestionMode } from "@/lib/settings";

import { chromeStyles } from "./sidebar-chrome";

/**
 * The AI reply-suggestions mode button (sparkles) shared by both sidebars.
 * Renders nothing when the server has no suggestion capability. Desktop
 * opens a popover mounted under the button; mobile keeps the sheet.
 */
export function SuggestionSettingsButton({ wide }: { wide: boolean }): React.JSX.Element | null {
  const theme = useTheme();
  const aiStatus = useAiStatus();
  const suggestionMode = useSuggestionMode();
  const showSheet = useActionSheet();
  const btnRef = useRef<View>(null);

  if (!aiStatus?.suggestions) return null;

  const openSettings = (): void => {
    const options: Array<{ label: string; mode: SuggestionMode }> = [
      { label: "Off", mode: "off" },
      { label: "On demand", mode: "on-demand" },
      { label: "Automatic", mode: "auto" },
    ];
    const show = (anchor?: { x: number; y: number }) =>
      showSheet({
        title: "Reply suggestions",
        actions: options.map((o) => ({
          // A leading check marks the active mode; the sheet has no selected state.
          label: `${suggestionMode === o.mode ? "✓  " : "    "}${o.label}`,
          onPress: () => setSuggestionMode(o.mode),
        })),
        anchor,
      });
    if (wide && btnRef.current) {
      btnRef.current.measureInWindow((x, y, _w, h) => show({ x, y: y + h + 4 }));
    } else {
      show();
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Suggestion settings"
      ref={btnRef}
      onPress={openSettings}
      style={({ pressed }) => [chromeStyles.actionButton, pressed && { opacity: 0.55 }]}
    >
      <Ionicons name="sparkles-outline" size={20} color={theme.accent} />
    </Pressable>
  );
}
