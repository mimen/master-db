import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { HOVER_DIM, PRESS_DIM } from "@/constants/interaction";
import { useSpring } from "@/constants/springs";
import { useTheme } from "@/hooks/use-theme";

import { BlurSwap } from "./blur-swap";

export type SendStatus = "idle" | "sending" | "sent";

export interface MorphSendButtonProps {
  readonly status: SendStatus;
  /** True while the composer is empty: the button stays dimmed and inert. */
  readonly disabled?: boolean;
  readonly onPress: () => void;
  /** iMessage blue by default; pass the SMS green for an SMS send. */
  readonly color?: string;
}

const SIZE = 34;
const CHECK_HOLD_MS = 900;
const DISABLED_OPACITY = 0.4;

/**
 * The composer's send button: arrow, then a spinning ring while sending, then a check that holds
 * for 900ms and swaps back to the arrow. Icons blur-swap on snappy; the ring is a linear loop
 * because a spinner is not a spring. Reduce Motion swaps instantly and holds the ring still.
 */
export function MorphSendButton({ status, disabled = false, onPress, color }: MorphSendButtonProps): React.JSX.Element {
  const theme = useTheme();
  const spring = useSpring("snappy");
  const [checkExpired, setCheckExpired] = useState(false);
  const pressed = useSharedValue(0);
  const dim = useSharedValue(disabled ? DISABLED_OPACITY : 1);

  useEffect(() => {
    setCheckExpired(false);
    if (status !== "sent") return;
    const id = setTimeout(() => setCheckExpired(true), CHECK_HOLD_MS);
    return () => clearTimeout(id);
  }, [status]);

  useEffect(() => {
    dim.value = withSpring(disabled ? DISABLED_OPACITY : 1, spring);
  }, [dim, disabled, spring]);

  const icon = status === "sending" ? "ring" : status === "sent" && !checkExpired ? "check" : "arrow";
  const label = icon === "ring" ? "Sending" : icon === "check" ? "Sent" : "Send";
  const body = useAnimatedStyle(() => ({ opacity: dim.value, transform: [{ scale: 1 - 0.04 * pressed.value }] }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || status !== "idle", busy: status === "sending" }}
      disabled={disabled || status !== "idle"}
      onPress={onPress}
      onPressIn={() => {
        pressed.value = withSpring(1, spring);
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, spring);
      }}
    >
      {({ hovered, pressed: down }: { hovered?: boolean; pressed: boolean }) => (
        <Animated.View style={[styles.button, body]}>
          <View style={[styles.fill, { backgroundColor: color ?? theme.accent, opacity: down ? PRESS_DIM : hovered && !disabled ? HOVER_DIM : 1 }]}>
            <BlurSwap swapKey={icon} variant="scale" style={styles.icon}>
              {icon === "ring" ? <Ring color={theme.onAccent} /> : (
                <Ionicons name={icon === "check" ? "checkmark" : "arrow-up"} size={20} color={theme.onAccent} />
              )}
            </BlurSwap>
          </View>
        </Animated.View>
      )}
    </Pressable>
  );
}

function Ring({ color }: { color: string }): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    turn.value = withRepeat(withTiming(360, { duration: 800, easing: Easing.linear }), -1);
    return () => cancelAnimation(turn);
  }, [reduceMotion, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  // Three of four border sides drawn: the ring reads as three-quarters when it holds still.
  return <Animated.View style={[styles.ring, { borderColor: color, borderTopColor: "transparent" }, spin]} />;
}

const styles = StyleSheet.create({
  button: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, overflow: "hidden" },
  fill: { flex: 1, alignItems: "center", justifyContent: "center" },
  icon: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  ring: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
});
