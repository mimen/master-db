import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { CardShadow } from "@/constants/theme";

export interface OverlayShellProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** "fade" (default) for dialogs/popovers; "slide" for a bottom sheet. */
  animationType?: "fade" | "slide" | "none";
  /** Backdrop scrim color. Defaults to the shared `backdrop` token — pass a
   * literal rgba for a site with a documented lighter/heavier scrim (the
   * token sweep in constants/theme.ts calls out 0.35/0.4 as intentional). */
  backdropColor?: string;
  /** Merged onto the backdrop Pressable. Default centers content on both
   * axes (`alignItems`/`justifyContent`: "center") — override for a site
   * that anchors differently (e.g. `justifyContent: "flex-end"` for a sheet,
   * or `paddingTop` for a panel that isn't vertically centered). */
  backdropStyle?: StyleProp<ViewStyle>;
  /** a11y on the backdrop's press-catcher. Most sites leave these unset —
   * only pass them where the site already labels the dismiss target. */
  backdropAccessibilityLabel?: string;
  backdropAccessibilityRole?: "button";
  /**
   * Wrap children in the shared centered-card panel: themed background +
   * the CardShadow color, with press-through swallowed so taps inside the
   * card don't fall through to the backdrop and dismiss it. Default true.
   *
   * Geometry (radius, shadowOffset/Opacity/Radius, width/height, border) is
   * genuinely per-surface — pass it via `cardStyle` rather than expecting a
   * shared token; see the theme.ts comment on why those aren't unified.
   *
   * Pass `card={false}` for a site that renders its own panel shape (a
   * bottom sheet, for instance) — children are still wrapped in an
   * unstyled press-swallowing layer, just without the card chrome. Do NOT
   * use `card={false}` for a panel that positions itself via absolute
   * top/left math (an anchored popover): the swallow wrapper becomes a new
   * relative-positioning ancestor, which shifts that math off (0, 0) and
   * silently breaks the anchor. Anchored popovers should keep their own
   * Modal instead of adopting this shell.
   */
  card?: boolean;
  cardStyle?: StyleProp<ViewStyle>;
}

/**
 * Shared wrapper for the app's hand-rolled `Modal` overlays: owns the Modal,
 * the backdrop (color + press-to-dismiss + `onRequestClose`, which is also
 * how react-native-web wires the Escape key — nothing extra needed here),
 * and optionally the centered-card panel look. Provider-based overlays
 * (action-sheet, lightbox) keep their own interfaces and don't use this.
 */
export function OverlayShell({
  visible,
  onClose,
  children,
  animationType = "fade",
  backdropColor,
  backdropStyle,
  backdropAccessibilityLabel,
  backdropAccessibilityRole,
  card = true,
  cardStyle,
}: OverlayShellProps) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType={animationType} onRequestClose={onClose}>
      <Pressable
        accessibilityRole={backdropAccessibilityRole}
        accessibilityLabel={backdropAccessibilityLabel}
        onPress={onClose}
        style={[styles.backdrop, { backgroundColor: backdropColor ?? theme.backdrop }, backdropStyle]}
      >
        <Pressable
          onPress={() => undefined}
          style={[card && [styles.card, { backgroundColor: theme.background }], cardStyle]}
        >
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    ...CardShadow,
  },
});
