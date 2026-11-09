import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Pressable } from "react-native";

import { useTheme } from "@/hooks/use-theme";
import { goBackOrHome } from "@/lib/back-navigation";

/** The phone's one back affordance: an accent chevron. */
export function BackButton({ onPress = () => goBackOrHome(router), label = "Back" }: {
  readonly onPress?: () => void;
  readonly label?: string;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={{ paddingHorizontal: 4 }}>
      <Ionicons name="chevron-back" size={26} color={theme.accent} />
    </Pressable>
  );
}
