// PROTOTYPE — floating comparison control. Delete after choosing a direction.
import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export interface PrototypeVariantOption {
  key: string;
  name: string;
}

interface PrototypeSwitcherProps {
  variants: readonly PrototypeVariantOption[];
  currentKey: string;
  onChange: (key: string) => void;
}

export function PrototypeSwitcher({ variants, currentKey, onChange }: PrototypeSwitcherProps) {
  const currentIndex = Math.max(0, variants.findIndex((variant) => variant.key === currentKey));

  const move = (offset: number) => {
    const nextIndex = (currentIndex + offset + variants.length) % variants.length;
    onChange(variants[nextIndex].key);
  };

  useEffect(() => {
    if (Platform.OS !== "web") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  if (!__DEV__) return null;

  const current = variants[currentIndex];

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        <Pressable accessibilityLabel="Previous design" onPress={() => move(-1)} style={styles.button}>
          <Ionicons name="chevron-back" color="#FFFFFF" size={18} />
        </Pressable>
        <View style={styles.labelWrap}>
          <Text style={styles.eyebrow}>PROTOTYPE {currentIndex + 1} OF {variants.length}</Text>
          <Text numberOfLines={1} style={styles.label}>{current.name}</Text>
        </View>
        <Pressable accessibilityLabel="Next design" onPress={() => move(1)} style={styles.button}>
          <Ionicons name="chevron-forward" color="#FFFFFF" size={18} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 18,
    alignItems: "center",
  },
  bar: {
    minWidth: 280,
    maxWidth: "88%",
    height: 58,
    borderRadius: 29,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111216",
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  button: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#292B31",
  },
  labelWrap: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  eyebrow: {
    color: "#A8ABB3",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  label: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 2,
  },
});
