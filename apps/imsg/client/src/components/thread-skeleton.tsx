import { StyleSheet, View, type DimensionValue } from "react-native";

import { useTheme } from "@/hooks/use-theme";

// Sizes from round3/html/desk-states.html "Thread loading", newest at the bottom.
const BUBBLES: readonly { width: DimensionValue; height: number; mine: boolean }[] = [
  { width: "58%", height: 34, mine: false },
  { width: "40%", height: 34, mine: true },
  { width: "70%", height: 52, mine: false },
  { width: "34%", height: 34, mine: true },
  { width: "48%", height: 34, mine: false },
];

/** Still bubble-shaped placeholders where a thread's messages will land. No shimmer by design. */
export function ThreadSkeleton() {
  const { skeleton } = useTheme();
  return (
    <View role="progressbar" aria-busy accessibilityLabel="Loading conversation" style={styles.container}>
      {BUBBLES.map((bubble, i) => (
        <View
          key={i}
          style={[styles.bubble, { width: bubble.width, height: bubble.height, backgroundColor: skeleton, alignSelf: bubble.mine ? "flex-end" : "flex-start" }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 8, justifyContent: "flex-end", padding: 14 },
  bubble: { borderRadius: 18, maxWidth: 420 },
});
