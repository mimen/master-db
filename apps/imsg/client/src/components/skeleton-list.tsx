import { StyleSheet, View } from "react-native";

import { useColorScheme } from "@/hooks/use-color-scheme";

// TODO(signal-tokens): read from tokens.ts once U1 lands
const SIGNAL = { light: { skeleton: "rgba(0,0,0,0.06)" }, dark: { skeleton: "rgba(255,255,255,0.07)" } } as const;

/** Still placeholder rows, in the conversation row's geometry, shown while the chat list first loads. */
export function SkeletonList({ rows = 9 }: { rows?: number }) {
  const { skeleton } = SIGNAL[useColorScheme() === "dark" ? "dark" : "light"];
  return (
    <View role="progressbar" aria-busy accessibilityLabel="Loading conversations" style={styles.list}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          <View style={[styles.avatar, { backgroundColor: skeleton }]} />
          <View style={styles.lines}>
            <View style={[styles.line, { width: "45%", backgroundColor: skeleton }]} />
            <View style={[styles.line, { width: "80%", backgroundColor: skeleton }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 8 },
  row: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 9 },
  avatar: { borderRadius: 18, height: 36, width: 36 },
  lines: { flex: 1, gap: 8 },
  line: { borderRadius: 999, height: 10 },
});
