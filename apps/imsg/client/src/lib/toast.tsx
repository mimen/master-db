import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useIsFocused } from "expo-router/react-navigation";

import { Springs } from "@/constants/springs";
import { CardShadow } from "@/constants/theme";
import { Space, TypeRamp, Weight } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";

export interface ToastAction {
  readonly label: string;
  readonly onPress: () => void;
  /** A keyboard shortcut that does the same thing, e.g. "⌘Z". */
  readonly hint?: string;
}

const RISE = 10;

interface Toast {
  readonly message: string;
  readonly action?: ToastAction;
}

const ToastContext = createContext<{
  readonly pill: ReactNode;
  readonly activeAnchor: symbol | undefined;
  readonly registerAnchor: (anchor: symbol) => () => void;
} | null>(null);

type Listener = (toast: Toast) => void;
let listener: Listener | null = null;

// A toast with a button stays long enough to reach the button.
const PLAIN_MS = 2200;
const ACTION_MS = 5000;

/** Fire-and-forget feedback; safe to call from anywhere. */
export function showToast(message: string, action?: ToastAction): void {
  listener?.({ message, action });
}

export function ToastAnchor({ children, active }: { readonly children: ReactNode; readonly active: boolean }) {
  const context = useContext(ToastContext);
  const anchor = useRef(Symbol("toast-anchor")).current;
  const focused = useIsFocused();
  const registerAnchor = context?.registerAnchor;
  useEffect(() => {
    if (active && focused) return registerAnchor?.(anchor);
  }, [active, anchor, focused, registerAnchor]);

  return (
    <View testID="thread-composer-chrome">
      {children}
      {/* Bottom-anchored over the composer card, so it never covers the suggestion chips above it. */}
      {context?.activeAnchor === anchor && (
        <View pointerEvents="box-none" style={[styles.overlay, { bottom: Space.md }]}>
          {context.pill}
        </View>
      )}
    </View>
  );
}

export function ToastHost({ children }: { readonly children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  // The toast stays mounted while it fades out; `shown` drives the fade.
  const [shown, setShown] = useState(false);
  const [anchors, setAnchors] = useState<ReadonlySet<symbol>>(() => new Set());
  const activeAnchor = Array.from(anchors).at(-1);
  const registerAnchor = useCallback((anchor: symbol) => {
    setAnchors((current) => new Set(current).add(anchor));
    return () => setAnchors((current) => {
      const next = new Set(current);
      next.delete(anchor);
      return next;
    });
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const c = useTheme();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const clear = useCallback(() => setToast(null), []);
  const insets = useSafeAreaInsets();
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
      setShown(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setShown(false), next.action ? ACTION_MS : PLAIN_MS);
    };
    return () => {
      listener = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    if (reduceMotion) {
      progress.value = shown ? 1 : 0;
      if (!shown) clear();
      return;
    }
    progress.value = shown
      ? withSpring(1, Springs.snappy)
      : withSpring(0, Springs.smooth, (finished) => {
          if (finished) scheduleOnRN(clear);
        });
  }, [clear, progress, reduceMotion, shown, toast]);

  // Enter rises and fades in; leave only fades, so the toast never drops back through the composer.
  const motion = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: shown ? Math.max(0, 1 - progress.value) * RISE : 0 }],
  }));

  const action = toast?.action;
  const pill = toast && (
    <Reanimated.View
      role="status"
      accessibilityLiveRegion="polite"
      pointerEvents={action && shown ? "box-none" : "none"}
      style={[styles.toast, { backgroundColor: c.toastBg }, motion]}
    >
      <Text style={[styles.text, { color: c.toastText }]}>{toast.message}</Text>
      {action && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={() => {
            if (timer.current) clearTimeout(timer.current);
            setShown(false);
            action.onPress();
          }}
          style={({ hovered, pressed }) => [styles.action, (hovered || pressed) && { backgroundColor: c.toastActionHover }]}
        >
          <Text style={[styles.actionText, { color: c.toastAction }]}>{action.label}</Text>
          {action.hint && <Text style={[styles.hint, { color: c.toastAction }]}>{action.hint}</Text>}
        </Pressable>
      )}
    </Reanimated.View>
  );
  return (
    <ToastContext.Provider value={{ pill, activeAnchor, registerAnchor }}>
      {children}
      {toast && activeAnchor === undefined && (
        <View pointerEvents="box-none" style={[styles.overlay, { bottom: Space.md + Math.max(keyboardHeight, insets.bottom) }]}>
          {pill}
        </View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 100,
    flexDirection: "row",
    justifyContent: "center",
    paddingHorizontal: Space.lg,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    minHeight: 44,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 7,
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
    alignItems: "center",
    borderRadius: 7,
    flexDirection: "row",
    gap: 6,
    height: 30,
    paddingHorizontal: 8,
  },
  actionText: {
    fontSize: TypeRamp.desktop.body,
    fontWeight: Weight.semibold,
  },
  hint: {
    fontSize: 11.5,
    fontVariant: ["tabular-nums"],
    fontWeight: "500",
    opacity: 0.6,
  },
});
