import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "expo-router/react-navigation";

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
      {context?.activeAnchor === anchor && (
        <View pointerEvents="box-none" style={[styles.overlay, { top: Space.md }]}>
          {context.pill}
        </View>
      )}
    </View>
  );
}

export function ToastHost({ children }: { readonly children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
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
  const dark = useColorScheme() === "dark";
  const inverse = Colors[dark ? "light" : "dark"];
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
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), next.action ? ACTION_MS : PLAIN_MS);
    };
    return () => {
      listener = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const action = toast?.action;
  const pill = toast && (
    <View
      role="status"
      accessibilityLiveRegion="polite"
      pointerEvents={action ? "box-none" : "none"}
      style={[styles.toast, { backgroundColor: inverse.background }]}
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
    </View>
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
