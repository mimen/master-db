import { Ionicons } from "@expo/vector-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native";
import { forwardRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { focusRing, focusVisible, type InteractionState } from "@/components/ui/interaction";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";

const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

export interface ChromeIconButtonProps {
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly hugeIcon?: IconSvgElement;
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
}

/**
 * Sidebar chrome action: a quiet icon that takes a row-hover tint. It
 * forwards its ref because the filter popover anchors to it.
 */
export const ChromeIconButton = forwardRef<View, ChromeIconButtonProps>(
  function ChromeIconButton({ icon, hugeIcon, accessibilityLabel, onPress }, ref): React.JSX.Element {
    const theme = useTheme();
    const { wide } = useLayoutMode();
    const size = wide ? 17 : 22;
    return (
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        {...NO_DRAG}
        style={(state: InteractionState) => [
          wide ? styles.wide : styles.phone,
          (state.hovered || state.pressed) && { backgroundColor: state.pressed ? theme.rowSelected : theme.rowHover },
          focusVisible(state) && focusRing(theme),
        ]}
      >
        {(state: InteractionState) => {
          const color = state.hovered || state.pressed ? theme.text : theme.icon;
          return hugeIcon ? (
            <HugeiconsIcon icon={hugeIcon} size={size} color={color} strokeWidth={1.6} />
          ) : (
            <Ionicons name={icon!} size={size} color={color} />
          );
        }}
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  wide: { alignItems: "center", borderRadius: 7, height: 30, justifyContent: "center", width: 30 },
  phone: { alignItems: "center", borderRadius: 10, height: 40, justifyContent: "center", width: 40 },
});
