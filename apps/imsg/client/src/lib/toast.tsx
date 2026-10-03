import { useEffect, useRef, useState } from "react";
import { Animated, Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CardShadow, Colors } from "@/constants/theme";
import { Radius, Space, TypeRamp, Weight } from "@/constants/tokens";
import { useColorScheme } from "@/hooks/use-color-scheme";

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
  const dark = useColorScheme() === "dark";
  const theme = Colors[dark ? "dark" : "light"];
  const inverse = Colors[dark ? "light" : "dark"];
  const insets = useSafeAreaInsets();
  // Same events as ThreadView's keyboard inset. The thread pads itself by this
  // height, so lifting the footer by it parks the pill in that padding, right
  // under the composer, instead of behind the keyboard.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const change = Keyboard.addListener("keyboardWillChangeFrame", (e) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboardHeight(0));
    return () => {
      change.remove();
      hide.remove();
    };
  }, []);

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
  // A normal-flow footer under the app: it shrinks the app's flex area, so the
  // pill can never cover the thread or the composer.
  return (
    <View
      style={[
        styles.footer,
        {
          backgroundColor: theme.background,
          paddingBottom: Space.md + (keyboardHeight > 0 ? 0 : insets.bottom),
          transform: [{ translateY: -keyboardHeight }],
        },
      ]}
    >
      <Animated.View
        role="status"
        accessibilityLiveRegion="polite"
        pointerEvents={action ? "box-none" : "none"}
        style={[styles.toast, { backgroundColor: inverse.background, opacity }]}
      >
        <Text style={[styles.text, { color: inverse.text }]}>{toast.message}</Text>
        {action && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => {
              if (timer.current) clearTimeout(timer.current);
              setToast(null);
              action.onPress();
            }}
            style={({ hovered, pressed }) => [styles.action, (hovered || pressed) && { backgroundColor: inverse.backgroundSelected }]}
          >
            <Text style={[styles.actionText, { color: inverse.text }]}>{action.label}</Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.lg,
    borderRadius: Radius.full,
    paddingLeft: Space.xl,
    paddingRight: Space.xl,
    paddingVertical: Space.md,
    flexShrink: 1,
    maxWidth: 420,
    ...CardShadow,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  text: {
    fontSize: TypeRamp.desktop.body,
    flexShrink: 1,
  },
  action: {
    borderRadius: Radius.full,
    marginRight: -Space.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
  },
  actionText: {
    fontSize: TypeRamp.desktop.body,
    fontWeight: Weight.semibold,
  },
});
