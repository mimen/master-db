import { useEffect, useRef, useState } from "react";
import { Animated, Platform, StyleSheet, Text } from "react-native";

type Listener = (message: string) => void;
let listener: Listener | null = null;

/** Fire-and-forget feedback bubble; safe to call from anywhere. */
export function showToast(message: string): void {
  listener?.(message);
}

export function ToastHost() {
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    listener = (text) => {
      setMessage(text);
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: Platform.OS !== "web" }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: Platform.OS !== "web",
        }).start(() => setMessage(null));
      }, 2200);
    };
    return () => {
      listener = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [opacity]);

  if (message === null) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.toast, { opacity }]}>
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    top: 60,
    alignSelf: "center",
    backgroundColor: "rgba(30,30,32,0.92)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 9,
    maxWidth: 340,
    zIndex: 1000,
    elevation: 10,
  },
  text: {
    color: "#fff",
    fontSize: 14,
    textAlign: "center",
  },
});
