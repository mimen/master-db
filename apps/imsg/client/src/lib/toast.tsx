import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text } from "react-native";

import { Radius, Space, TypeRamp, Weight } from "@/constants/tokens";

export interface ToastAction {
  readonly label: string;
  readonly onPress: () => void;
}

interface Toast {
  readonly message: string;
  readonly action?: ToastAction;
}

type Listener = (toast: Toast) => void;
let listener: Listener | null = null;

// A toast with a button stays long enough to reach the button.
const PLAIN_MS = 2200;
const ACTION_MS = 5000;

/** Fire-and-forget feedback; safe to call from anywhere. */
export function showToast(message: string, action?: ToastAction): void {
  listener?.({ message, action });
}

export function ToastHost() {
  const [toast, setToast] = useState<Toast | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const useNativeDriver = Platform.OS !== "web";

  useEffect(() => {
    listener = (next) => {
      setToast(next);
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver }).start(() => setToast(null));
      }, next.action ? ACTION_MS : PLAIN_MS);
    };
    return () => {
      listener = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [opacity, useNativeDriver]);

  if (toast === null) return null;
  const { action } = toast;
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      pointerEvents={action ? "box-none" : "none"}
      style={[styles.toast, { opacity }]}
    >
      <Text style={styles.text}>{toast.message}</Text>
      {action && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={() => {
            if (timer.current) clearTimeout(timer.current);
            setToast(null);
            action.onPress();
          }}
          style={({ hovered, pressed }) => [styles.action, (hovered || pressed) && styles.actionActive]}
        >
          <Text style={styles.actionText}>{action.label}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    // Clears the composer and its suggestion shelf.
    bottom: 132,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: Space.lg,
    // Fixed dark pill, deliberately theme-invariant (system-HUD style toast).
    backgroundColor: "rgba(30,30,32,0.92)",
    borderRadius: Radius.full,
    paddingLeft: Space.xl,
    paddingRight: Space.xl,
    paddingVertical: Space.md,
    maxWidth: 420,
    zIndex: 1000,
    elevation: 10,
  },
  text: {
    color: "#fff",
    fontSize: TypeRamp.desktop.body,
    flexShrink: 1,
  },
  action: {
    borderRadius: Radius.full,
    marginRight: -Space.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
  },
  actionActive: {
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  actionText: {
    color: "#fff",
    fontSize: TypeRamp.desktop.body,
    fontWeight: Weight.semibold,
  },
});
