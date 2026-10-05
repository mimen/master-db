import { useEffect, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { useSpring } from "@/constants/springs";
import { useTheme } from "@/hooks/use-theme";
import { CardShadow } from "@/constants/theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface OverlayShellProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** "fade" (default) springs the panel open from 0.98 on snappy; "slide" is the native bottom sheet. */
  animationType?: "fade" | "slide" | "none";
  /** Backdrop scrim color. Defaults to the shared `backdrop` token; pass a
   * literal rgba for a site with a documented lighter or heavier scrim. */
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
  /** Names the panel for assistive tech; the backdrop alone reads as one "Close" button. */
  accessibilityLabel?: string;
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
  accessibilityLabel,
}: OverlayShellProps) {
  const theme = useTheme();
  const animated = animationType === "fade";
  const snappy = useSpring("snappy");
  const shown = useSharedValue(0);
  // The Modal stays mounted until the close spring lands, so the panel can leave instead of cutting.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (!animated) return;
    const unmount = () => setMounted(false);
    // Close is quicker than open: the same spring, but it ends once the panel reads as gone.
    shown.value = withSpring(visible ? 1 : 0, visible ? snappy : { ...snappy, energyThreshold: 1e-3 }, (finished) => {
      "worklet";
      if (finished && !visible) runOnJS(unmount)();
    });
  }, [animated, shown, snappy, visible]);

  const scrim = useAnimatedStyle(() => ({ opacity: shown.value }));
  // The panel inherits the scrim's fade, so it only scales.
  const panel = useAnimatedStyle(() => ({ transform: [{ scale: 0.98 + 0.02 * shown.value }] }));

  return (
    <Modal
      visible={animated ? mounted : visible}
      transparent
      animationType={animated ? "none" : animationType}
      onRequestClose={onClose}
    >
      <AnimatedPressable
        accessibilityRole={backdropAccessibilityRole ?? "button"}
        accessibilityLabel={backdropAccessibilityLabel ?? "Close"}
        onPress={onClose}
        pointerEvents={visible ? "auto" : "none"}
        style={[styles.backdrop, { backgroundColor: backdropColor ?? theme.backdrop }, backdropStyle, animated && scrim]}
      >
        <AnimatedPressable
          accessible={false}
          {...(accessibilityLabel ? { role: "dialog", "aria-modal": true, "aria-label": accessibilityLabel } as object : null)}
          onPress={() => undefined}
          style={[card && [styles.card, { backgroundColor: theme.background }], cardStyle, animated && panel]}
        >
          {children}
        </AnimatedPressable>
      </AnimatedPressable>
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
